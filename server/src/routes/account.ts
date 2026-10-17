import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import { sql } from '../db.ts';
import { config } from '../config.ts';
import { bool, idParam, newApi, route, z } from '../lib/api.ts';
import {
  ALL_SCOPES, SESSION_COOKIE, clearSessionCookie, createSession, requireAdmin, requireHuman, setSessionCookie, type AppEnv,
} from '../lib/auth.ts';
import { decrypt, encrypt, hashPassword, randomToken, sign, tokenHash, verifyPassword, verifySig } from '../lib/crypto.ts';
import { badRequest, forbidden, notFound } from '../lib/errors.ts';
import { notify, pushStatus, unreadCount, vapidKeys } from '../lib/notify.ts';
import { seedCategories } from '../services/misc.ts';
import { backendsFor, createBackend, forgetDriver, makeDriver, pickBackend, publicBackend } from '../storage/index.ts';
import { DRIVE_SCOPES, GDriveDriver, oauthClient } from '../storage/gdrive.ts';

const COLORS = ['#6366f1', '#ec4899', '#14b8a6', '#f97316', '#8b5cf6', '#06b6d4', '#84cc16', '#e11d48'];
const pickColor = () => COLORS[Math.floor(Math.random() * COLORS.length)];

export const DEFAULT_SETTINGS = {
  theme: 'system',
  markRead: 'auto' as 'auto' | 'manual',
  push: { agent_post: true, reminder: true, comment: true, share: true },
  reelsMuted: false,
  dataSaver: false,
};

function publicUser(u: any) {
  return {
    id: u.id, kind: u.kind, role: u.role, name: u.name, email: u.email, color: u.avatar_color,
    description: u.description, disabled: u.disabled, createdAt: u.created_at, lastSeenAt: u.last_seen_at,
    settings: { ...DEFAULT_SETTINGS, ...(u.settings ?? {}), push: { ...DEFAULT_SETTINGS.push, ...(u.settings?.push ?? {}) } },
  };
}

export async function createHuman(input: { email: string; name: string; password: string; role?: 'admin' | 'user' }) {
  if (input.password.length < 8) throw badRequest('Password must be at least 8 characters');
  const [u] = await sql`
    INSERT INTO users (kind, role, email, name, password_hash, avatar_color)
    VALUES ('human', ${input.role ?? 'user'}, ${input.email.trim()}, ${input.name.trim()}, ${await hashPassword(input.password)}, ${pickColor()})
    ON CONFLICT DO NOTHING RETURNING *`;
  if (!u) throw badRequest('A user with that email already exists');
  await seedCategories(u.id);
  return u;
}

/** Admin account from docker-compose env (ADMIN_EMAIL / ADMIN_PASSWORD). */
export async function ensureAdmin() {
  const { email, password, name, resetPassword } = config.admin;
  if (!email || !password) {
    const [any] = await sql`SELECT 1 FROM users WHERE role = 'admin' LIMIT 1`;
    if (!any) console.warn('[auth] No admin yet: set ADMIN_EMAIL and ADMIN_PASSWORD in docker-compose.yml');
    return;
  }
  const [u] = await sql`SELECT * FROM users WHERE lower(email) = ${email.toLowerCase()}`;
  if (!u) {
    await createHuman({ email, name, password, role: 'admin' });
    console.log(`[auth] Created admin ${email}`);
  } else {
    if (u.role !== 'admin' || u.disabled) await sql`UPDATE users SET role = 'admin', disabled = false WHERE id = ${u.id}`;
    if (resetPassword) {
      await sql`UPDATE users SET password_hash = ${await hashPassword(password)} WHERE id = ${u.id}`;
      await sql`DELETE FROM sessions WHERE user_id = ${u.id}`;
      console.log(`[auth] Admin password reset from env for ${email}`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Public routes (no session needed)
// ---------------------------------------------------------------------------------------------
export const publicRoutes = new Hono<AppEnv>();

const failures = new Map<string, { n: number; until: number }>();

publicRoutes.post('/auth/login', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? (c.env as any)?.incoming?.socket?.remoteAddress ?? 'ip';
  const key = `${ip}|${email}`;
  const f = failures.get(key);
  if (f && f.n >= 8 && f.until > Date.now()) throw new HTTPException(429, { message: 'Too many attempts, try again in a few minutes' });

  const [u] = await sql`SELECT * FROM users WHERE lower(email) = ${email} AND kind = 'human'`;
  if (!u || u.disabled || !(await verifyPassword(password, u.password_hash))) {
    failures.set(key, { n: (f && f.until > Date.now() ? f.n : 0) + 1, until: Date.now() + 15 * 60_000 });
    throw new HTTPException(401, { message: 'Wrong email or password' });
  }
  failures.delete(key);
  const token = await createSession(u.id, c.req.header('user-agent') ?? '');
  setSessionCookie(c, token);
  await sql`UPDATE users SET last_seen_at = now() WHERE id = ${u.id}`;
  return c.json({ token, user: publicUser(u) });
});

publicRoutes.post('/auth/logout', async (c) => {
  const token = c.req.header('authorization')?.replace(/^bearer /i, '') ?? getCookie(c, SESSION_COOKIE);
  if (token) await sql`DELETE FROM sessions WHERE token_hash = ${tokenHash(token)}`;
  clearSessionCookie(c);
  return c.json({ ok: true });
});

publicRoutes.get('/health', async (c) => {
  await sql`SELECT 1`;
  return c.json({ ok: true, name: 'Timeline' });
});

// Google Drive OAuth return. State is signed, so this needs no session cookie (works from the mobile app's browser too).
publicRoutes.get('/storage/google/callback', async (c) => {
  const state = c.req.query('state') ?? '';
  const [payload, sig] = state.split('.');
  if (!payload || !sig || !verifySig(payload, sig)) return c.text('Invalid or expired link. Please try connecting again.', 400);
  const st = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { u: string; exp: number; client: string };
  if (st.exp < Date.now()) return c.text('This link expired. Please try connecting again.', 400);
  const done = (q: string) =>
    c.redirect(st.client === 'app' ? `timeline://settings/storage?${q}` : `${config.publicUrl}/settings/storage?${q}`);
  if (c.req.query('error')) return done(`drive=error&reason=${encodeURIComponent(c.req.query('error')!)}`);

  const client = oauthClient(googleRedirectUri());
  const { tokens } = await client.getToken(c.req.query('code') ?? '');
  if (!tokens.refresh_token) return done('drive=error&reason=no_refresh_token');
  const { folderId, account } = await GDriveDriver.createFolder(tokens.refresh_token, config.google.folderName);
  const cfg = { refreshToken: tokens.refresh_token, folderId, account };

  const existing = (await backendsFor(st.u)).find((b) => b.type === 'gdrive' && b.owner_id === st.u && decrypt(b.config).account === account);
  let id: string;
  if (existing) {
    await sql`UPDATE storage_backends SET config = ${encrypt(cfg)} WHERE id = ${existing.id}`;
    forgetDriver(existing.id);
    id = existing.id;
  } else {
    id = (await createBackend(st.u, 'gdrive', `Google Drive`, cfg)).id;
  }
  // Google Drive becomes the default for new uploads.
  await sql`UPDATE users SET settings = settings || ${sql.json({ defaultBackendId: id })} WHERE id = ${st.u}`;
  return done('drive=connected');
});

export function googleRedirectUri() {
  return `${config.publicUrl}/api/storage/google/callback`;
}

// ---------------------------------------------------------------------------------------------
// Authenticated routes
// ---------------------------------------------------------------------------------------------
export const account = newApi();

const settingsSchema = z.object({
  theme: z.string().max(30).optional(),
  markRead: z.enum(['auto', 'manual']).optional().describe('auto = mark posts read as you scroll past them'),
  push: z.object({ agent_post: z.boolean(), reminder: z.boolean(), comment: z.boolean(), share: z.boolean() }).partial().optional(),
  reelsMuted: z.boolean().optional(),
  dataSaver: z.boolean().optional(),
  defaultBackendId: z.string().uuid().nullable().optional(),
});

route(account, { method: 'get', path: '/me', tag: 'Account', summary: 'Current user, settings and the timelines you can view' }, async (c) => {
  const user = c.get('user');
  const [u] = await sql`SELECT * FROM users WHERE id = ${user.id}`;
  const timelines = await sql`
    SELECT u.id, u.name, u.avatar_color, s.can_comment FROM timeline_shares s JOIN users u ON u.id = s.owner_id
    WHERE s.viewer_id = ${user.timelineId} AND s.status = 'accepted' ORDER BY u.name`;
  const [owner] = await sql`SELECT id, name, avatar_color FROM users WHERE id = ${user.timelineId}`;
  return {
    user: publicUser(u),
    via: user.via,
    scopes: user.scopes,
    timelines: [
      { id: owner.id, name: owner.name, color: owner.avatar_color, mine: true, canComment: true },
      ...timelines.map((t) => ({ id: t.id, name: t.name, color: t.avatar_color, mine: false, canComment: t.can_comment })),
    ],
    unread: await unreadCount(user.timelineId),
  };
});

route(
  account,
  { method: 'patch', path: '/me', tag: 'Account', summary: 'Update profile and settings', body: z.object({ name: z.string().min(1).max(80).optional(), color: z.string().max(20).optional(), settings: settingsSchema.optional() }) },
  async (c, { body }) => {
    const user = c.get('user');
    const [u] = await sql`SELECT * FROM users WHERE id = ${user.id}`;
    const settings = { ...(u.settings ?? {}), ...(body.settings ?? {}) };
    if (body.settings?.push) settings.push = { ...DEFAULT_SETTINGS.push, ...(u.settings?.push ?? {}), ...body.settings.push };
    if (body.settings?.defaultBackendId) {
      const ok = (await backendsFor(user.timelineId)).some((b) => b.id === body.settings!.defaultBackendId);
      if (!ok) throw badRequest('Unknown storage backend');
    }
    const [n] = await sql`UPDATE users SET name = ${body.name ?? u.name}, avatar_color = ${body.color ?? u.avatar_color},
                          settings = ${sql.json(settings)} WHERE id = ${user.id} RETURNING *`;
    return publicUser(n);
  },
);

route(account, { method: 'post', path: '/me/password', tag: 'Account', summary: 'Change password', body: z.object({ current: z.string(), next: z.string().min(8) }) }, async (c, { body }) => {
  const user = requireHuman(c);
  const [u] = await sql`SELECT password_hash FROM users WHERE id = ${user.id}`;
  if (!(await verifyPassword(body.current, u.password_hash))) throw badRequest('Current password is wrong');
  await sql`UPDATE users SET password_hash = ${await hashPassword(body.next)} WHERE id = ${user.id}`;
  return { ok: true };
});

// ------------------------------- agents & API keys -------------------------------

const scopesSchema = z.array(z.enum(['read', 'write', 'delete', 'purge'])).min(1);

async function issueKey(userId: string, name: string, scopes: string[]) {
  const key = randomToken('tlk_');
  const [k] = await sql`INSERT INTO api_keys (user_id, name, prefix, key_hash, scopes)
                        VALUES (${userId}, ${name}, ${key.slice(0, 12)}, ${tokenHash(key)}, ${scopes}) RETURNING id, name, prefix, scopes, created_at`;
  return { ...k, key };
}

async function keysFor(userIds: string[]) {
  return sql`SELECT id, user_id AS "userId", name, prefix, scopes, last_used_at AS "lastUsedAt", created_at AS "createdAt"
             FROM api_keys WHERE user_id = ANY(${userIds}) AND revoked_at IS NULL ORDER BY created_at`;
}

route(account, { method: 'get', path: '/agents', tag: 'Agents', summary: 'Your AI agents' }, async (c) => {
  const user = requireHuman(c);
  const agents = await sql`
    SELECT u.*, (SELECT count(*)::int FROM posts p WHERE p.author_id = u.id AND p.deleted_at IS NULL) AS post_count
    FROM users u WHERE u.owner_id = ${user.id} ORDER BY u.disabled, u.created_at`;
  const keys = await keysFor(agents.map((a) => a.id));
  return agents.map((a) => ({ ...publicUser(a), postCount: a.post_count, keys: keys.filter((k) => k.userId === a.id) }));
});

route(
  account,
  {
    method: 'post',
    path: '/agents',
    tag: 'Agents',
    summary: 'Create an AI agent; returns its API key once',
    body: z.object({ name: z.string().min(1).max(80), description: z.string().max(2000).optional(), color: z.string().optional(), scopes: scopesSchema.optional() }),
  },
  async (c, { body }) => {
    const user = requireHuman(c);
    const [a] = await sql`INSERT INTO users (kind, owner_id, name, description, avatar_color)
                          VALUES ('agent', ${user.id}, ${body.name}, ${body.description ?? ''}, ${body.color ?? pickColor()}) RETURNING *`;
    const key = await issueKey(a.id, 'default', body.scopes ?? ['read', 'write', 'delete']);
    return { agent: publicUser(a), apiKey: key.key, keyInfo: key };
  },
);

async function myAgent(userId: string, agentId: string) {
  const [a] = await sql`SELECT * FROM users WHERE id = ${agentId} AND owner_id = ${userId}`;
  if (!a) throw notFound('Agent not found');
  return a;
}

route(
  account,
  { method: 'patch', path: '/agents/{id}', tag: 'Agents', summary: 'Edit an agent', params: idParam, body: z.object({ name: z.string().min(1).max(80).optional(), description: z.string().max(2000).optional(), color: z.string().optional(), disabled: z.boolean().optional() }) },
  async (c, { params, body }) => {
    const user = requireHuman(c);
    const a = await myAgent(user.id, params.id);
    const [n] = await sql`UPDATE users SET name = ${body.name ?? a.name}, description = ${body.description ?? a.description},
                          avatar_color = ${body.color ?? a.avatar_color}, disabled = ${body.disabled ?? a.disabled} WHERE id = ${a.id} RETURNING *`;
    return publicUser(n);
  },
);

route(account, { method: 'delete', path: '/agents/{id}', tag: 'Agents', summary: 'Retire an agent: revokes its keys, keeps its posts', params: idParam }, async (c, { params }) => {
  const user = requireHuman(c);
  await myAgent(user.id, params.id);
  await sql`UPDATE users SET disabled = true WHERE id = ${params.id}`;
  await sql`UPDATE api_keys SET revoked_at = now() WHERE user_id = ${params.id} AND revoked_at IS NULL`;
  return { ok: true };
});

route(account, { method: 'post', path: '/agents/{id}/keys', tag: 'Agents', summary: 'Issue another API key for an agent', params: idParam, body: z.object({ name: z.string().max(80).optional(), scopes: scopesSchema.optional() }) }, async (c, { params, body }) => {
  const user = requireHuman(c);
  await myAgent(user.id, params.id);
  return issueKey(params.id, body.name ?? 'key', body.scopes ?? ['read', 'write', 'delete']);
});

route(account, { method: 'get', path: '/keys', tag: 'Agents', summary: 'Your personal API keys (act as you)' }, async (c) => keysFor([requireHuman(c).id]));

route(account, { method: 'post', path: '/keys', tag: 'Agents', summary: 'Create a personal API key', body: z.object({ name: z.string().min(1).max(80), scopes: scopesSchema.optional() }) }, async (c, { body }) =>
  issueKey(requireHuman(c).id, body.name, body.scopes ?? ALL_SCOPES),
);

route(account, { method: 'delete', path: '/keys/{id}', tag: 'Agents', summary: 'Revoke an API key (yours or one of your agents)', params: idParam }, async (c, { params }) => {
  const user = requireHuman(c);
  const r = await sql`UPDATE api_keys k SET revoked_at = now() FROM users u
                      WHERE k.id = ${params.id} AND u.id = k.user_id AND (u.id = ${user.id} OR u.owner_id = ${user.id}) RETURNING k.id`;
  if (!r.length) throw notFound('Key not found');
  return { ok: true };
});

// ------------------------------- timeline sharing -------------------------------

route(account, { method: 'get', path: '/shares', tag: 'Sharing', summary: 'Timelines you share and that are shared with you' }, async (c) => {
  const user = requireHuman(c);
  const out = await sql`SELECT s.*, u.name, u.email, u.avatar_color FROM timeline_shares s JOIN users u ON u.id = s.viewer_id WHERE s.owner_id = ${user.id} ORDER BY u.name`;
  const inc = await sql`SELECT s.*, u.name, u.email, u.avatar_color FROM timeline_shares s JOIN users u ON u.id = s.owner_id WHERE s.viewer_id = ${user.id} ORDER BY u.name`;
  const m = (r: any, other: string) => ({ ownerId: r.owner_id, viewerId: r.viewer_id, user: { id: r[other], name: r.name, email: r.email, color: r.avatar_color }, canComment: r.can_comment, status: r.status, createdAt: r.created_at });
  return { outgoing: out.map((r) => m(r, 'viewer_id')), incoming: inc.map((r) => m(r, 'owner_id')) };
});

route(account, { method: 'post', path: '/shares', tag: 'Sharing', summary: 'Share your timeline with another user (they must accept)', body: z.object({ email: z.string(), canComment: z.boolean().optional() }) }, async (c, { body }) => {
  const user = requireHuman(c);
  const [v] = await sql`SELECT id, name FROM users WHERE lower(email) = ${body.email.trim().toLowerCase()} AND kind = 'human' AND NOT disabled`;
  if (!v) throw notFound('No user with that email');
  if (v.id === user.id) throw badRequest("That's you");
  await sql`INSERT INTO timeline_shares (owner_id, viewer_id, can_comment) VALUES (${user.id}, ${v.id}, ${body.canComment ?? true})
            ON CONFLICT (owner_id, viewer_id) DO UPDATE SET can_comment = EXCLUDED.can_comment`;
  await notify({ userId: v.id, type: 'share', actorId: user.id, title: `${user.name} shared their timeline with you`, body: 'Open Settings → Sharing to accept' });
  return { ok: true };
});

route(account, { method: 'post', path: '/shares/{ownerId}/accept', tag: 'Sharing', summary: 'Accept a shared timeline', params: z.object({ ownerId: z.string().uuid() }) }, async (c, { params }) => {
  const user = requireHuman(c);
  const r = await sql`UPDATE timeline_shares SET status = 'accepted' WHERE owner_id = ${params.ownerId} AND viewer_id = ${user.id} RETURNING owner_id`;
  if (!r.length) throw notFound('Share not found');
  return { ok: true };
});

route(account, { method: 'patch', path: '/shares/{viewerId}', tag: 'Sharing', summary: 'Change what a viewer may do', params: z.object({ viewerId: z.string().uuid() }), body: z.object({ canComment: z.boolean() }) }, async (c, { params, body }) => {
  const user = requireHuman(c);
  await sql`UPDATE timeline_shares SET can_comment = ${body.canComment} WHERE owner_id = ${user.id} AND viewer_id = ${params.viewerId}`;
  return { ok: true };
});

route(account, { method: 'delete', path: '/shares/{ownerId}/{viewerId}', tag: 'Sharing', summary: 'Stop sharing (either side)', params: z.object({ ownerId: z.string().uuid(), viewerId: z.string().uuid() }) }, async (c, { params }) => {
  const user = requireHuman(c);
  if (user.id !== params.ownerId && user.id !== params.viewerId) throw forbidden();
  await sql`DELETE FROM timeline_shares WHERE owner_id = ${params.ownerId} AND viewer_id = ${params.viewerId}`;
  return { ok: true };
});

// ------------------------------- storage -------------------------------

route(account, { method: 'get', path: '/storage', tag: 'Storage', summary: 'Storage backends and which one new uploads go to' }, async (c) => {
  const user = c.get('user');
  const list = await backendsFor(user.timelineId);
  const def = await pickBackend(user.timelineId).catch(() => null);
  const counts = await sql`SELECT backend_id, count(*)::int AS n, coalesce(sum(size), 0)::bigint AS bytes FROM attachments
                           WHERE owner_id = ${user.timelineId} GROUP BY backend_id`;
  return {
    defaultBackendId: def?.id ?? null,
    googleConfigured: !!(config.google.clientId && config.google.clientSecret),
    googleRedirectUri: googleRedirectUri(),
    backends: list.map((b) => {
      const cnt = counts.find((x) => x.backend_id === b.id);
      return { ...publicBackend(b), files: cnt?.n ?? 0, bytes: Number(cnt?.bytes ?? 0), isDefault: b.id === def?.id, canRemove: b.owner_id === user.timelineId || (b.owner_id === null && !b.from_env && user.role === 'admin') };
    }),
  };
});

route(account, { method: 'get', path: '/storage/google/start', tag: 'Storage', summary: 'Start "Connect Google Drive" (returns the Google consent URL)', query: z.object({ client: z.enum(['web', 'app']).optional() }) }, async (c, { query }) => {
  const user = requireHuman(c);
  if (!config.google.clientId || !config.google.clientSecret)
    throw badRequest('Google Drive is not set up on this server yet. The admin needs to add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (see README).');
  const payload = Buffer.from(JSON.stringify({ u: user.id, exp: Date.now() + 15 * 60_000, client: query.client ?? 'web' })).toString('base64url');
  const url = oauthClient(googleRedirectUri()).generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: DRIVE_SCOPES,
    state: `${payload}.${sign(payload)}`,
    include_granted_scopes: true,
  });
  return { url };
});

const s3Body = z.object({
  name: z.string().min(1).max(80),
  endpoint: z.string().describe('e.g. https://s3.us-west-004.backblazeb2.com or https://<account>.r2.cloudflarestorage.com'),
  region: z.string().optional(),
  bucket: z.string().min(1),
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
  prefix: z.string().optional(),
  forcePathStyle: z.boolean().optional(),
  shared: z.boolean().optional().describe('Admin only: make available to all users'),
});

route(account, { method: 'post', path: '/storage/s3', tag: 'Storage', summary: 'Add an S3-compatible bucket (Backblaze B2, Cloudflare R2, AWS S3, MinIO)', body: s3Body }, async (c, { body }) => {
  const user = requireHuman(c);
  if (body.shared && user.role !== 'admin') throw forbidden('Only the admin can add shared storage');
  const { shared, name, ...cfg } = body;
  const region = cfg.region || (cfg.endpoint.match(/s3\.([a-z0-9-]+)\.backblazeb2\.com/)?.[1] ?? 'auto');
  const full = { ...cfg, region, prefix: cfg.prefix ?? 'timeline/' };
  try {
    await makeDriver('s3', full).check();
  } catch (e) {
    throw badRequest(`Could not reach the bucket: ${(e as Error).message}`);
  }
  const b = await createBackend(shared ? null : user.id, 's3', name, full);
  return publicBackend(b);
});

route(account, { method: 'post', path: '/storage/{id}/test', tag: 'Storage', summary: 'Test a storage backend', params: idParam }, async (c, { params }) => {
  const user = c.get('user');
  const b = (await backendsFor(user.timelineId)).find((x) => x.id === params.id);
  if (!b) throw notFound('Storage not found');
  try {
    await makeDriver(b.type, decrypt(b.config)).check();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

route(account, { method: 'delete', path: '/storage/{id}', tag: 'Storage', summary: 'Remove a storage backend (only when it holds no files)', params: idParam }, async (c, { params }) => {
  const user = requireHuman(c);
  const b = (await backendsFor(user.id)).find((x) => x.id === params.id);
  if (!b || b.from_env || (b.owner_id === null && user.role !== 'admin') || (b.owner_id && b.owner_id !== user.id)) throw notFound('Storage not found');
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM attachments WHERE backend_id = ${b.id}`;
  if (n > 0) throw badRequest(`${n} files are stored there. Remove those posts first.`);
  await sql`DELETE FROM storage_backends WHERE id = ${b.id}`;
  forgetDriver(b.id);
  return { ok: true };
});

// ------------------------------- push devices -------------------------------

route(account, { method: 'get', path: '/push/config', tag: 'Notifications', summary: 'Push configuration (web push public key, FCM availability)' }, async () => {
  const st = await pushStatus();
  return { vapidPublicKey: (await vapidKeys()).publicKey, fcm: st.fcm };
});

route(
  account,
  { method: 'post', path: '/push/devices', tag: 'Notifications', summary: 'Register a device for push', body: z.object({ platform: z.enum(['fcm', 'webpush']), token: z.string().min(10).max(4000), label: z.string().max(120).optional() }) },
  async (c, { body }) => {
    const user = requireHuman(c);
    await sql`INSERT INTO push_devices (user_id, platform, token, label) VALUES (${user.id}, ${body.platform}, ${body.token}, ${body.label ?? ''})
              ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, label = EXCLUDED.label`;
    return { ok: true };
  },
);

route(account, { method: 'post', path: '/push/devices/remove', tag: 'Notifications', summary: 'Unregister a device', body: z.object({ token: z.string() }) }, async (c, { body }) => {
  await sql`DELETE FROM push_devices WHERE token = ${body.token} AND user_id = ${c.get('user').id}`;
  return { ok: true };
});

route(account, { method: 'post', path: '/push/test', tag: 'Notifications', summary: 'Send yourself a test notification' }, async (c) => {
  const user = requireHuman(c);
  await notify({ userId: user.id, type: 'reminder', title: 'Test notification', body: 'Notifications are working 🎉' });
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM push_devices WHERE user_id = ${user.id}`;
  return { ok: true, devices: n };
});

// ------------------------------- admin -------------------------------

route(account, { method: 'get', path: '/admin/users', tag: 'Admin', summary: 'List people' }, async (c) => {
  requireAdmin(c);
  const rows = await sql`
    SELECT u.*, (SELECT count(*)::int FROM posts p WHERE p.owner_id = u.id AND p.deleted_at IS NULL) AS post_count,
           (SELECT count(*)::int FROM users a WHERE a.owner_id = u.id AND NOT a.disabled) AS agent_count
    FROM users u WHERE u.kind = 'human' ORDER BY u.created_at`;
  return rows.map((u) => ({ ...publicUser(u), postCount: u.post_count, agentCount: u.agent_count }));
});

route(
  account,
  { method: 'post', path: '/admin/users', tag: 'Admin', summary: 'Create a person account', body: z.object({ email: z.string().email(), name: z.string().min(1), password: z.string().min(8), role: z.enum(['admin', 'user']).optional() }) },
  async (c, { body }) => {
    requireAdmin(c);
    return publicUser(await createHuman(body));
  },
);

route(
  account,
  { method: 'patch', path: '/admin/users/{id}', tag: 'Admin', summary: 'Edit a person (role, disable, reset password)', params: idParam, body: z.object({ name: z.string().optional(), email: z.string().email().optional(), role: z.enum(['admin', 'user']).optional(), disabled: z.boolean().optional(), password: z.string().min(8).optional() }) },
  async (c, { params, body }) => {
    const admin = requireAdmin(c);
    const [u] = await sql`SELECT * FROM users WHERE id = ${params.id} AND kind = 'human'`;
    if (!u) throw notFound('User not found');
    if (u.id === admin.id && (body.disabled || body.role === 'user')) throw badRequest("You can't demote or disable yourself");
    const [n] = await sql`UPDATE users SET name = ${body.name ?? u.name}, email = ${body.email ?? u.email}, role = ${body.role ?? u.role},
                          disabled = ${body.disabled ?? u.disabled},
                          password_hash = ${body.password ? await hashPassword(body.password) : u.password_hash}
                          WHERE id = ${u.id} RETURNING *`;
    if (body.disabled || body.password) await sql`DELETE FROM sessions WHERE user_id = ${u.id}`;
    return publicUser(n);
  },
);

route(account, { method: 'delete', path: '/admin/users/{id}', tag: 'Admin', summary: 'Delete a person and ALL their data', params: idParam, query: z.object({ confirm: z.string() }) }, async (c, { params, query }) => {
  const admin = requireAdmin(c);
  if (params.id === admin.id) throw badRequest("You can't delete yourself");
  const [u] = await sql`SELECT email FROM users WHERE id = ${params.id} AND kind = 'human'`;
  if (!u) throw notFound('User not found');
  if (query.confirm !== u.email) throw badRequest('Pass ?confirm=<their email> to confirm');
  const { purgePostsByIds } = await import('../services/posts.ts');
  const ps = await sql`SELECT id FROM posts WHERE owner_id = ${params.id}`;
  await purgePostsByIds(ps.map((p) => p.id));
  await sql`UPDATE attachments SET owner_id = ${admin.id} WHERE owner_id = ${params.id}`; // pending file deletions keep running
  await sql`DELETE FROM users WHERE id = ${params.id}`;
  return { ok: true };
});

route(account, { method: 'get', path: '/admin/status', tag: 'Admin', summary: 'Server status: jobs, storage, push' }, async (c) => {
  requireAdmin(c);
  const jobs = await sql`SELECT type, status, count(*)::int AS n FROM jobs WHERE status <> 'done' GROUP BY type, status`;
  const failed = await sql`SELECT id, type, last_error, created_at FROM jobs WHERE status = 'failed' ORDER BY id DESC LIMIT 20`;
  const [totals] = await sql`SELECT (SELECT count(*)::int FROM posts) AS posts, (SELECT count(*)::int FROM attachments) AS files,
                             (SELECT coalesce(sum(size),0)::bigint FROM attachments) AS bytes, pg_database_size(current_database())::bigint AS db_bytes`;
  return { jobs, failed, totals: { ...totals, bytes: Number(totals.bytes), db_bytes: Number(totals.db_bytes) }, push: await pushStatus(), google: !!config.google.clientId, publicUrl: config.publicUrl };
});

route(account, { method: 'post', path: '/admin/jobs/retry', tag: 'Admin', summary: 'Retry failed jobs', body: z.object({ ids: z.array(z.number()).optional() }) }, async (c, { body }) => {
  requireAdmin(c);
  const r = body.ids?.length
    ? await sql`UPDATE jobs SET status = 'queued', attempts = 0, run_at = now() WHERE status = 'failed' AND id = ANY(${body.ids}) RETURNING id`
    : await sql`UPDATE jobs SET status = 'queued', attempts = 0, run_at = now() WHERE status = 'failed' RETURNING id`;
  return { retried: r.length };
});

