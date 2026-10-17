import fs from 'node:fs';
import webpush from 'web-push';
import { sql } from '../db.ts';
import { config } from '../config.ts';

export type NotificationType = 'agent_post' | 'reminder' | 'comment' | 'share';

const DEFAULT_PUSH: Record<NotificationType, boolean> = { agent_post: true, reminder: true, comment: true, share: true };

// ---------- Firebase Cloud Messaging (Android, and iOS later through APNs-in-FCM) ----------
let fcm: import('firebase-admin/messaging').Messaging | null | undefined;

async function getFcm() {
  if (fcm !== undefined) return fcm;
  let json = config.firebaseServiceAccount;
  if (!json && config.firebaseServiceAccountFile && fs.existsSync(config.firebaseServiceAccountFile)) {
    json = fs.readFileSync(config.firebaseServiceAccountFile, 'utf8');
  }
  if (!json) return (fcm = null);
  const { initializeApp, cert } = await import('firebase-admin/app');
  const { getMessaging } = await import('firebase-admin/messaging');
  const app = initializeApp({ credential: cert(JSON.parse(json)) }, 'timeline');
  return (fcm = getMessaging(app));
}

export async function pushStatus() {
  return { fcm: !!(await getFcm()), webpush: !!(await vapidKeys()).publicKey };
}

// ---------- Web Push (desktop / mobile browsers) ----------
let vapid: { publicKey: string; privateKey: string } | undefined;

export async function vapidKeys() {
  if (vapid) return vapid;
  if (config.vapid.publicKey && config.vapid.privateKey) {
    vapid = { publicKey: config.vapid.publicKey, privateKey: config.vapid.privateKey };
  } else {
    const [row] = await sql`SELECT value FROM app_kv WHERE key = 'vapid'`;
    if (row) vapid = row.value as any;
    else {
      vapid = webpush.generateVAPIDKeys();
      await sql`INSERT INTO app_kv (key, value) VALUES ('vapid', ${sql.json(vapid)}) ON CONFLICT (key) DO NOTHING`;
    }
  }
  webpush.setVapidDetails(config.vapid.subject, vapid!.publicKey, vapid!.privateKey);
  return vapid!;
}

export async function unreadCount(userId: string): Promise<number> {
  const [r] = await sql`SELECT count(*)::int AS n FROM notifications WHERE user_id = ${userId} AND read_at IS NULL`;
  return r.n;
}

interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  postId?: string | null;
  actorId?: string | null;
}

/** Store an in-app notification (bell badge) and push it to the user's devices. */
export async function notify(n: NotifyInput) {
  const [row] = await sql`
    INSERT INTO notifications (user_id, type, title, body, post_id, actor_id)
    VALUES (${n.userId}, ${n.type}, ${n.title.slice(0, 200)}, ${(n.body ?? '').slice(0, 500)}, ${n.postId ?? null}, ${n.actorId ?? null})
    RETURNING id`;
  sendPush(n, row.id).catch((e) => console.error('[push] failed', e?.message ?? e));
  return row.id as string;
}

async function sendPush(n: NotifyInput, notificationId: string) {
  const [u] = await sql`SELECT settings FROM users WHERE id = ${n.userId}`;
  const prefs = { ...DEFAULT_PUSH, ...(u?.settings?.push ?? {}) };
  if (!prefs[n.type]) return;
  const devices = await sql`SELECT id, platform, token FROM push_devices WHERE user_id = ${n.userId}`;
  if (!devices.length) return;
  const badge = await unreadCount(n.userId);
  const data = { notificationId, type: n.type, postId: n.postId ?? '', url: n.postId ? `/post/${n.postId}` : '/notifications' };

  const fcmTokens = devices.filter((d) => d.platform === 'fcm').map((d) => d.token as string);
  const messaging = fcmTokens.length ? await getFcm() : null;
  if (messaging && fcmTokens.length) {
    const res = await messaging.sendEachForMulticast({
      tokens: fcmTokens,
      notification: { title: n.title, body: n.body || undefined },
      data,
      android: {
        priority: 'high',
        notification: {
          // Channels are created by the app; reminders get their own (louder) channel.
          channelId: n.type === 'reminder' ? 'reminders' : 'default',
          sound: 'default',
          notificationCount: badge,
          tag: notificationId,
        },
      },
      apns: { payload: { aps: { sound: 'default', badge } } },
    });
    const dead: string[] = [];
    res.responses.forEach((r, i) => {
      const code = r.error?.code ?? '';
      if (code.includes('registration-token-not-registered') || code.includes('invalid-registration-token')) dead.push(fcmTokens[i]);
    });
    if (dead.length) await sql`DELETE FROM push_devices WHERE token = ANY(${dead})`;
  }

  const web = devices.filter((d) => d.platform === 'webpush');
  if (web.length) {
    await vapidKeys();
    const payload = JSON.stringify({ title: n.title, body: n.body ?? '', badge, ...data });
    await Promise.all(
      web.map(async (d) => {
        try {
          await webpush.sendNotification(JSON.parse(d.token), payload, { TTL: 86400, urgency: 'high' });
        } catch (e: any) {
          if (e?.statusCode === 404 || e?.statusCode === 410) await sql`DELETE FROM push_devices WHERE id = ${d.id}`;
        }
      }),
    );
  }
  await sql`UPDATE push_devices SET last_used_at = now() WHERE user_id = ${n.userId}`;
}
