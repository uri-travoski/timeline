import { sql } from '../db.ts';
import { avatarUrl } from '../lib/avatar.ts';
import type { AuthUser } from '../lib/auth.ts';
import { badRequest, forbidden, notFound } from '../lib/errors.ts';
import { enqueue } from '../lib/jobs.ts';
import { notify } from '../lib/notify.ts';
import { loadVisiblePost, purgePostsByIds, serializePosts } from './posts.ts';
import { serializeAttachment } from './attachments.ts';

// ------------------------------- comments -------------------------------

function serializeComment(c: any) {
  return {
    id: c.id,
    postId: c.post_id,
    parentId: c.parent_id,
    body: c.body,
    source: c.source,
    author: { id: c.author_id, name: c.author_name, kind: c.author_kind, color: c.author_color, avatarUrl: avatarUrl(c.author_id, c.author_avatar_v) },
    createdAt: c.created_at,
    editedAt: c.edited_at,
    deletedAt: c.deleted_at,
  };
}

const commentSelect = sql`SELECT c.*, u.name AS author_name, u.kind AS author_kind, u.avatar_color AS author_color, u.avatar_v AS author_avatar_v
                          FROM comments c JOIN users u ON u.id = c.author_id`;

export async function listComments(user: AuthUser, postId: string) {
  await loadVisiblePost(user, postId);
  const rows = await sql`${commentSelect} WHERE c.post_id = ${postId} AND c.deleted_at IS NULL ORDER BY c.created_at`;
  return rows.map(serializeComment);
}

export async function addComment(user: AuthUser, postId: string, body: string, parentId?: string | null, source = 'web') {
  if (!body.trim()) throw badRequest('Comment is empty');
  const p = await loadVisiblePost(user, postId);
  const mine = p.owner_id === user.timelineId;
  if (!mine && !p.share_can_comment) throw forbidden('You can view but not comment on this timeline');
  if (parentId) {
    const [parent] = await sql`SELECT id FROM comments WHERE id = ${parentId} AND post_id = ${postId}`;
    if (!parent) throw badRequest('Parent comment not found on this post');
  }
  const [c] = await sql`INSERT INTO comments (post_id, parent_id, author_id, body, source)
                        VALUES (${postId}, ${parentId ?? null}, ${user.id}, ${body}, ${source}) RETURNING id`;
  if (user.id !== p.owner_id) {
    await notify({ userId: p.owner_id, type: 'comment', postId, actorId: user.id, title: `${user.name} commented`, body: body.slice(0, 140) });
  }
  const [row] = await sql`${commentSelect} WHERE c.id = ${c.id}`;
  return serializeComment(row);
}

async function ownComment(user: AuthUser, id: string, allowTimelineOwner: boolean) {
  const [c] = await sql`SELECT c.*, p.owner_id FROM comments c JOIN posts p ON p.id = c.post_id WHERE c.id = ${id}`;
  if (!c) throw notFound('Comment not found');
  const isAuthor = c.author_id === user.id || (user.kind === 'human' && (await isMyAgent(user, c.author_id)));
  if (!isAuthor && !(allowTimelineOwner && c.owner_id === user.timelineId)) throw forbidden('Not your comment');
  return c;
}

async function isMyAgent(user: AuthUser, id: string) {
  const [r] = await sql`SELECT 1 FROM users WHERE id = ${id} AND owner_id = ${user.id}`;
  return !!r;
}

export async function editComment(user: AuthUser, id: string, body: string) {
  if (!body.trim()) throw badRequest('Comment is empty');
  await ownComment(user, id, false);
  await sql`UPDATE comments SET body = ${body}, edited_at = now() WHERE id = ${id}`;
  const [row] = await sql`${commentSelect} WHERE c.id = ${id}`;
  return serializeComment(row);
}

export async function deleteComment(user: AuthUser, id: string) {
  await ownComment(user, id, true);
  await sql`UPDATE comments SET deleted_at = now(), deleted_by = ${user.id} WHERE id = ${id}`;
  return { ok: true, id, inRecycleBin: true };
}

// ------------------------------- categories & tags -------------------------------

export async function listCategories(user: AuthUser) {
  // Own categories plus non-private categories of timelines shared with you.
  const rows = await sql`
    SELECT c.*, u.name AS owner_name,
      (SELECT count(*)::int FROM posts p WHERE p.category_id = c.id AND p.deleted_at IS NULL) AS post_count
    FROM categories c JOIN users u ON u.id = c.owner_id
    WHERE c.owner_id = ${user.timelineId}
       OR (NOT c.is_private AND c.owner_id IN (SELECT owner_id FROM timeline_shares WHERE viewer_id = ${user.timelineId} AND status = 'accepted'))
    ORDER BY (c.owner_id = ${user.timelineId}) DESC, c.sort, c.name`;
  return rows.map((c) => ({
    id: c.id, name: c.name, color: c.color, icon: c.icon, isPrivate: c.is_private, sort: c.sort,
    postCount: c.post_count, timelineId: c.owner_id, timelineName: c.owner_name, mine: c.owner_id === user.timelineId,
  }));
}

export const DEFAULT_CATEGORIES = [
  { name: 'Personal', color: '#22c55e', icon: 'user' },
  { name: 'Work', color: '#3b82f6', icon: 'briefcase' },
  { name: 'Entertainment', color: '#f59e0b', icon: 'clapperboard' },
  { name: 'Private', color: '#ef4444', icon: 'lock', isPrivate: true },
];

export async function seedCategories(ownerId: string) {
  let i = 0;
  for (const c of DEFAULT_CATEGORIES) {
    await sql`INSERT INTO categories (owner_id, name, color, icon, is_private, sort)
              VALUES (${ownerId}, ${c.name}, ${c.color}, ${c.icon}, ${!!c.isPrivate}, ${i++}) ON CONFLICT DO NOTHING`;
  }
}

export async function listTags(user: AuthUser, q?: string) {
  const like = q ? `%${q}%` : '%';
  return sql`
    SELECT t.name, count(p.id)::int AS "postCount"
    FROM tags t
    LEFT JOIN post_tags pt ON pt.tag_id = t.id
    LEFT JOIN posts p ON p.id = pt.post_id AND p.deleted_at IS NULL
    WHERE (t.owner_id = ${user.timelineId}
           OR t.owner_id IN (SELECT owner_id FROM timeline_shares WHERE viewer_id = ${user.timelineId} AND status = 'accepted'))
      AND t.name ILIKE ${like}
    GROUP BY t.name ORDER BY count(p.id) DESC, t.name LIMIT 500`;
}

// ------------------------------- reminders -------------------------------

export interface ReminderInput {
  title: string;
  body?: string;
  dueAt: string;
  repeat?: 'daily' | 'weekly' | 'monthly' | 'yearly' | null;
  postId?: string | null;
}

function serializeReminder(r: any) {
  return {
    id: r.id, title: r.title, body: r.body, dueAt: r.due_at, repeat: r.repeat, postId: r.post_id,
    status: r.status, lastFiredAt: r.last_fired_at, createdAt: r.created_at, createdBy: r.created_by_name ?? null,
  };
}

export async function listReminders(user: AuthUser, includeDone = false) {
  const rows = await sql`
    SELECT r.*, u.name AS created_by_name FROM reminders r LEFT JOIN users u ON u.id = r.created_by
    WHERE r.owner_id = ${user.timelineId} ${includeDone ? sql`` : sql`AND r.status = 'scheduled'`}
    ORDER BY r.due_at`;
  return rows.map(serializeReminder);
}

export async function createReminder(user: AuthUser, input: ReminderInput) {
  const due = new Date(input.dueAt);
  if (Number.isNaN(due.getTime())) throw badRequest('Invalid dueAt (use ISO 8601, e.g. 2026-10-20T09:00:00+01:00)');
  if (input.postId) await loadVisiblePost(user, input.postId);
  const [r] = await sql`
    INSERT INTO reminders (owner_id, created_by, title, body, due_at, repeat, post_id)
    VALUES (${user.timelineId}, ${user.id}, ${input.title}, ${input.body ?? ''}, ${due}, ${input.repeat ?? null}, ${input.postId ?? null})
    RETURNING *`;
  return serializeReminder(r);
}

export async function updateReminder(user: AuthUser, id: string, input: Partial<ReminderInput> & { status?: 'scheduled' | 'cancelled' }) {
  const [r] = await sql`SELECT * FROM reminders WHERE id = ${id} AND owner_id = ${user.timelineId}`;
  if (!r) throw notFound('Reminder not found');
  const due = input.dueAt ? new Date(input.dueAt) : r.due_at;
  if (Number.isNaN(new Date(due).getTime())) throw badRequest('Invalid dueAt');
  const [u] = await sql`
    UPDATE reminders SET title = ${input.title ?? r.title}, body = ${input.body ?? r.body}, due_at = ${due},
      repeat = ${input.repeat === undefined ? r.repeat : input.repeat}, post_id = ${input.postId === undefined ? r.post_id : input.postId},
      status = ${input.status ?? (input.dueAt ? 'scheduled' : r.status)}
    WHERE id = ${id} RETURNING *`;
  return serializeReminder(u);
}

export async function deleteReminder(user: AuthUser, id: string) {
  const r = await sql`DELETE FROM reminders WHERE id = ${id} AND owner_id = ${user.timelineId} RETURNING id`;
  if (!r.length) throw notFound('Reminder not found');
  return { ok: true };
}

function nextDue(d: Date, repeat: string): Date {
  const n = new Date(d);
  if (repeat === 'daily') n.setUTCDate(n.getUTCDate() + 1);
  else if (repeat === 'weekly') n.setUTCDate(n.getUTCDate() + 7);
  else if (repeat === 'monthly') n.setUTCMonth(n.getUTCMonth() + 1);
  else n.setUTCFullYear(n.getUTCFullYear() + 1);
  return n;
}

/** Called by the worker every few seconds. */
export async function fireDueReminders() {
  while (true) {
    const fired = await sql.begin(async (tx) => {
      const [r] = await tx`SELECT * FROM reminders WHERE status = 'scheduled' AND due_at <= now()
                           ORDER BY due_at FOR UPDATE SKIP LOCKED LIMIT 1`;
      if (!r) return null;
      // The reminder card: a small post shown on the timeline until it is marked as read.
      const [card] = await tx`
        INSERT INTO posts (owner_id, author_id, kind, title, body, source, source_name, ref_post_id, posted_at)
        VALUES (${r.owner_id}, ${r.created_by ?? r.owner_id}, 'reminder', ${r.title}, ${r.body}, 'reminder', '', ${r.post_id}, now())
        RETURNING id`;
      if (r.repeat) {
        let due = nextDue(r.due_at, r.repeat);
        while (due <= new Date()) due = nextDue(due, r.repeat);
        await tx`UPDATE reminders SET due_at = ${due}, last_fired_at = now() WHERE id = ${r.id}`;
      } else {
        await tx`UPDATE reminders SET status = 'done', last_fired_at = now() WHERE id = ${r.id}`;
      }
      return { r, cardId: card.id as string };
    });
    if (!fired) return;
    await notify({
      userId: fired.r.owner_id,
      type: 'reminder',
      postId: fired.cardId,
      actorId: fired.r.created_by,
      title: `⏰ ${fired.r.title}`,
      body: fired.r.body,
    });
  }
}

// ------------------------------- recycle bin -------------------------------

export async function listTrash(user: AuthUser) {
  const own = user.timelineId;
  const [posts, comments, atts] = await Promise.all([
    sql`SELECT p.* FROM posts p WHERE p.owner_id = ${own} AND p.deleted_at IS NOT NULL ORDER BY p.deleted_at DESC LIMIT 500`,
    sql`${commentSelect} JOIN posts p ON p.id = c.post_id
        WHERE c.deleted_at IS NOT NULL AND p.deleted_at IS NULL AND (p.owner_id = ${own} OR c.author_id = ${user.id})
        ORDER BY c.deleted_at DESC LIMIT 500`,
    sql`SELECT a.* FROM attachments a JOIN posts p ON p.id = a.post_id
        WHERE a.owner_id = ${own} AND a.deleted_at IS NOT NULL AND p.deleted_at IS NULL ORDER BY a.deleted_at DESC LIMIT 500`,
  ]);
  return {
    posts: await serializePosts(user, posts),
    comments: comments.map(serializeComment),
    attachments: atts.map((a) => ({ ...serializeAttachment(a), deletedAt: a.deleted_at })),
  };
}

type TrashType = 'post' | 'comment' | 'attachment';

async function trashTarget(user: AuthUser, type: TrashType, id: string) {
  const own = user.timelineId;
  if (type === 'post') {
    const [p] = await sql`SELECT id FROM posts WHERE id = ${id} AND owner_id = ${own} AND deleted_at IS NOT NULL`;
    if (!p) throw notFound('Not in the recycle bin');
  } else if (type === 'comment') {
    const [c] = await sql`SELECT c.id FROM comments c JOIN posts p ON p.id = c.post_id
                          WHERE c.id = ${id} AND c.deleted_at IS NOT NULL AND (p.owner_id = ${own} OR c.author_id = ${user.id})`;
    if (!c) throw notFound('Not in the recycle bin');
  } else {
    const [a] = await sql`SELECT id FROM attachments WHERE id = ${id} AND owner_id = ${own} AND deleted_at IS NOT NULL`;
    if (!a) throw notFound('Not in the recycle bin');
  }
}

export async function restoreFromTrash(user: AuthUser, type: TrashType, id: string) {
  await trashTarget(user, type, id);
  if (type === 'post') await sql`UPDATE posts SET deleted_at = NULL, deleted_by = NULL WHERE id = ${id}`;
  if (type === 'comment') await sql`UPDATE comments SET deleted_at = NULL, deleted_by = NULL WHERE id = ${id}`;
  if (type === 'attachment') await sql`UPDATE attachments SET deleted_at = NULL WHERE id = ${id}`;
  return { ok: true };
}

export async function purgeFromTrash(user: AuthUser, type: TrashType, id: string) {
  await trashTarget(user, type, id);
  if (type === 'post') await purgePostsByIds([id]);
  if (type === 'comment') await sql`DELETE FROM comments WHERE id = ${id}`;
  if (type === 'attachment') {
    await sql`UPDATE attachments SET post_id = NULL WHERE id = ${id}`;
    await enqueue('delete_object', { attachmentId: id });
  }
  return { ok: true };
}

export async function emptyTrash(user: AuthUser) {
  const own = user.timelineId;
  const posts = await sql`SELECT id FROM posts WHERE owner_id = ${own} AND deleted_at IS NOT NULL`;
  await purgePostsByIds(posts.map((p) => p.id));
  await sql`DELETE FROM comments c USING posts p WHERE p.id = c.post_id AND c.deleted_at IS NOT NULL AND p.owner_id = ${own}`;
  const atts = await sql`UPDATE attachments SET post_id = NULL WHERE owner_id = ${own} AND deleted_at IS NOT NULL AND post_id IS NOT NULL RETURNING id`;
  for (const a of atts) await enqueue('delete_object', { attachmentId: a.id });
  return { ok: true, posts: posts.length, attachments: atts.length };
}

/** Worker: permanently remove things that sat in the recycle bin longer than the retention period. */
export async function autoPurge(retentionDays: number) {
  const cutoff = sql`now() - ${`${retentionDays} days`}::interval`;
  const posts = await sql`SELECT id FROM posts WHERE deleted_at IS NOT NULL AND deleted_at < ${cutoff} LIMIT 1000`;
  await purgePostsByIds(posts.map((p) => p.id));
  await sql`DELETE FROM comments WHERE deleted_at IS NOT NULL AND deleted_at < ${cutoff}`;
  const atts = await sql`UPDATE attachments SET post_id = NULL
                         WHERE deleted_at IS NOT NULL AND deleted_at < ${cutoff} AND post_id IS NOT NULL RETURNING id`;
  // Uploads never attached to a post within a day are abandoned.
  const orphans = await sql`UPDATE attachments SET deleted_at = now()
                            WHERE post_id IS NULL AND deleted_at IS NULL AND created_at < now() - interval '1 day' RETURNING id`;
  for (const a of [...atts, ...orphans]) await enqueue('delete_object', { attachmentId: a.id });
}

// ------------------------------- agent tasks -------------------------------

export async function upsertAgentTask(user: AuthUser, input: { name: string; description?: string; schedule?: string; status?: string; lastResult?: string }) {
  if (user.kind !== 'agent') throw forbidden('Only agents report tasks');
  const [t] = await sql`
    INSERT INTO agent_tasks (agent_id, name, description, schedule, status, last_run_at, last_result)
    VALUES (${user.id}, ${input.name}, ${input.description ?? ''}, ${input.schedule ?? ''}, ${input.status ?? 'active'}, now(), ${input.lastResult ?? ''})
    ON CONFLICT (agent_id, lower(name)) DO UPDATE SET
      description = CASE WHEN ${input.description ?? null}::text IS NULL THEN agent_tasks.description ELSE EXCLUDED.description END,
      schedule = CASE WHEN ${input.schedule ?? null}::text IS NULL THEN agent_tasks.schedule ELSE EXCLUDED.schedule END,
      status = EXCLUDED.status, last_run_at = now(), last_result = EXCLUDED.last_result
    RETURNING *`;
  return t;
}

export async function listAgentTasks(user: AuthUser) {
  const rows = await sql`
    SELECT t.*, u.name AS agent_name FROM agent_tasks t JOIN users u ON u.id = t.agent_id
    WHERE ${user.kind === 'agent' ? sql`t.agent_id = ${user.id}` : sql`u.owner_id = ${user.id}`}
    ORDER BY t.last_run_at DESC NULLS LAST`;
  return rows.map((t) => ({
    id: t.id, agentId: t.agent_id, agentName: t.agent_name, name: t.name, description: t.description,
    schedule: t.schedule, status: t.status, lastRunAt: t.last_run_at, lastResult: t.last_result,
  }));
}

export async function deleteAgentTask(user: AuthUser, id: string) {
  const r = await sql`DELETE FROM agent_tasks t USING users u WHERE t.id = ${id} AND u.id = t.agent_id
                      AND (t.agent_id = ${user.id} OR u.owner_id = ${user.id}) RETURNING t.id`;
  if (!r.length) throw notFound('Task not found');
  return { ok: true };
}
