import { HTTPException } from 'hono/http-exception';
import { avatarUrl } from '../lib/avatar.ts';
import { bool, csv, idParam, newApi, route, z } from '../lib/api.ts';
import { requireScope } from '../lib/auth.ts';
import { badRequest } from '../lib/errors.ts';
import { sql } from '../db.ts';
import * as posts from '../services/posts.ts';
import * as misc from '../services/misc.ts';
import { createUpload, queueUrlImport, loadAttachment, serializeAttachment } from '../services/attachments.ts';
import { unreadCount } from '../lib/notify.ts';

export const content = newApi();

export const feedQuery = z.object({
  timelines: csv.describe('Timeline (user) ids to combine. Default: your own. Use "all" for yours + every shared timeline.'),
  categories: csv.describe('Category names or ids, comma separated'),
  tags: csv.describe('Tag names, comma separated'),
  tagMode: z.enum(['any', 'all']).optional().describe('Match any tag (default) or all tags'),
  from: z.string().optional().describe('From date, inclusive (YYYY-MM-DD or ISO datetime)'),
  to: z.string().optional().describe('To date, inclusive (YYYY-MM-DD or ISO datetime)'),
  q: z.string().optional().describe('Full-text search over title, text, source, tags and file names'),
  fileTypes: csv.describe('image, video, audio, pdf, document, archive, other, text (= posts without files)'),
  authors: csv.describe('Author user ids'),
  authorKind: z.enum(['human', 'agent']).optional(),
  sources: csv.describe('web, android, ios, api, agent, email, reminder'),
  unread: bool.describe('Only unread posts'),
  order: z.enum(['desc', 'asc']).optional(),
  cursor: z.string().optional().describe('nextCursor from the previous page'),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

async function expandTimelines(c: any, f: posts.FeedFilters) {
  if (f.timelines?.includes('all')) {
    const user = c.get('user');
    const shares = await sql`SELECT owner_id FROM timeline_shares WHERE viewer_id = ${user.timelineId} AND status = 'accepted'`;
    f.timelines = [user.timelineId, ...shares.map((s) => s.owner_id)];
  }
  return f;
}

// ------------------------------- posts -------------------------------

route(content, { method: 'get', path: '/posts', tag: 'Posts', summary: 'List / search / filter the timeline', query: feedQuery }, async (c, { query }) =>
  posts.listPosts(c.get('user'), await expandTimelines(c, query)),
);

route(content, { method: 'get', path: '/reels', tag: 'Posts', summary: 'Video-only feed (reels mode), same filters as /posts', query: feedQuery }, async (c, { query }) =>
  posts.listReels(c.get('user'), await expandTimelines(c, query)),
);

export const createPostBody = z.object({
  title: z.string().max(300).optional(),
  body: z.string().max(100_000).optional().describe('Post text (Markdown allowed)'),
  category: z.string().nullable().optional().describe('Category name or id'),
  tags: z.array(z.string()).max(50).optional(),
  postedAt: z.string().optional().describe('ISO datetime; defaults to now. Use to backdate/import.'),
  attachmentIds: z.array(z.string().uuid()).max(100).optional().describe('Ids returned by the upload endpoints'),
  source: z.string().max(30).optional().describe('Override source label (default: web/android/agent/api)'),
  sourceName: z.string().max(300).optional().describe('Where it came from, e.g. "instagram.com/@nasa"'),
  sourceUrl: z.string().max(2000).nullable().optional().describe('Original URL. Unique per timeline: re-posting returns 409.'),
  sourceMeta: z.record(z.string(), z.any()).optional(),
});

route(content, { method: 'post', path: '/posts', tag: 'Posts', summary: 'Create a post', body: createPostBody }, (c, { body }) =>
  posts.createPost(c.get('user'), body, c.req.header('x-client')),
);

route(
  content,
  {
    method: 'post',
    path: '/posts/import',
    tag: 'Posts',
    summary: 'Create a post from a URL (Instagram/YouTube/TikTok/X page or direct file); the server downloads the media',
    body: createPostBody.omit({ attachmentIds: true, sourceUrl: true }).extend({
      url: z.string().url(),
      backendId: z.string().uuid().optional(),
    }),
  },
  async (c, { body }) => {
    const { url, backendId, ...rest } = body;
    const user = c.get('user');
    const post = await posts.createPost(user, { ...rest, sourceUrl: url, sourceName: rest.sourceName ?? new URL(url).host }, c.req.header('x-client'));
    await queueUrlImport(user, url, { postId: post.id, backendId });
    return post;
  },
);

route(
  content,
  { method: 'get', path: '/posts/lookup', tag: 'Posts', summary: 'Check whether a source URL was already posted', query: z.object({ sourceUrl: z.string() }) },
  async (c, { query }) => {
    const user = c.get('user');
    const [p] = await sql`SELECT id, deleted_at FROM posts WHERE owner_id = ${user.timelineId} AND source_url = ${query.sourceUrl}`;
    return { exists: !!p, postId: p?.id ?? null, deleted: !!p?.deleted_at };
  },
);

route(content, { method: 'get', path: '/posts/{id}', tag: 'Posts', summary: 'Get a post', params: idParam }, (c, { params }) =>
  posts.getPost(c.get('user'), params.id),
);

route(
  content,
  {
    method: 'patch',
    path: '/posts/{id}',
    tag: 'Posts',
    summary: 'Edit a post (previous version is kept in revisions)',
    params: idParam,
    body: z.object({
      title: z.string().max(300).optional(),
      body: z.string().max(100_000).optional(),
      category: z.string().nullable().optional(),
      tags: z.array(z.string()).max(50).optional(),
      postedAt: z.string().optional(),
      addAttachmentIds: z.array(z.string().uuid()).optional(),
      removeAttachmentIds: z.array(z.string().uuid()).optional().describe('Moves those files to the recycle bin'),
      attachmentOrder: z.array(z.string().uuid()).optional(),
    }),
  },
  (c, { params, body }) => posts.updatePost(c.get('user'), params.id, body),
);

route(content, { method: 'delete', path: '/posts/{id}', tag: 'Posts', summary: 'Move a post to the recycle bin', params: idParam }, (c, { params }) =>
  posts.deletePost(c.get('user'), params.id),
);

route(content, { method: 'post', path: '/posts/{id}/restore', tag: 'Posts', summary: 'Restore a post from the recycle bin', params: idParam }, (c, { params }) =>
  posts.restorePost(c.get('user'), params.id),
);

route(content, { method: 'delete', path: '/posts/{id}/purge', tag: 'Posts', summary: 'Permanently delete a post that is in the recycle bin (needs "purge" scope)', params: idParam }, (c, { params }) => {
  requireScope(c, 'purge');
  return posts.purgePost(c.get('user'), params.id);
});

route(content, { method: 'get', path: '/posts/{id}/revisions', tag: 'Posts', summary: 'Edit history', params: idParam }, (c, { params }) =>
  posts.listRevisions(c.get('user'), params.id),
);

// ------------------------------- read state -------------------------------

route(content, { method: 'post', path: '/reads', tag: 'Posts', summary: 'Mark posts as read (also clears their notifications)', body: z.object({ postIds: z.array(z.string()).max(500) }) }, (c, { body }) =>
  posts.markRead(c.get('user'), body.postIds, true),
);

route(content, { method: 'post', path: '/reads/unread', tag: 'Posts', summary: 'Mark posts as unread', body: z.object({ postIds: z.array(z.string()).max(500) }) }, (c, { body }) =>
  posts.markRead(c.get('user'), body.postIds, false),
);

// ------------------------------- comments -------------------------------

route(content, { method: 'get', path: '/posts/{id}/comments', tag: 'Comments', summary: 'List comments', params: idParam }, (c, { params }) =>
  misc.listComments(c.get('user'), params.id),
);

route(
  content,
  { method: 'post', path: '/posts/{id}/comments', tag: 'Comments', summary: 'Add a comment', params: idParam, body: z.object({ body: z.string().min(1).max(20_000), parentId: z.string().uuid().nullable().optional() }) },
  (c, { params, body }) => {
    const user = c.get('user');
    const client = c.req.header('x-client');
    const source = user.kind === 'agent' ? 'agent' : user.via === 'apikey' ? 'api' : ['android', 'ios'].includes(client ?? '') ? client! : 'web';
    return misc.addComment(user, params.id, body.body, body.parentId, source);
  },
);

route(content, { method: 'patch', path: '/comments/{id}', tag: 'Comments', summary: 'Edit your comment', params: idParam, body: z.object({ body: z.string().min(1).max(20_000) }) }, (c, { params, body }) =>
  misc.editComment(c.get('user'), params.id, body.body),
);

route(content, { method: 'delete', path: '/comments/{id}', tag: 'Comments', summary: 'Move a comment to the recycle bin', params: idParam }, (c, { params }) =>
  misc.deleteComment(c.get('user'), params.id),
);

// ------------------------------- uploads -------------------------------

const uploadQuery = z.object({
  filename: z.string().min(1).max(250),
  mime: z.string().optional(),
  backendId: z.string().uuid().optional().describe('Storage backend; default: your default (Google Drive if connected)'),
});

// Raw body upload: streams straight to disk, so multi-GB videos are fine.
content.put('/uploads', async (c) => {
  const q = uploadQuery.safeParse(c.req.query());
  if (!q.success) throw badRequest('filename query parameter is required');
  if (!c.req.raw.body) throw badRequest('Empty body');
  const att = await createUpload(c.get('user'), c.req.raw.body, {
    filename: q.data.filename,
    mime: q.data.mime ?? c.req.header('content-type'),
    backendId: q.data.backendId,
  });
  return c.json(att);
});

// Multipart upload (handy for curl -F file=@photo.jpg). Buffered in memory: prefer PUT for big files.
content.post('/uploads', async (c) => {
  const form = await c.req.parseBody({ all: true });
  const files = ([] as unknown[]).concat(form.file ?? form.files ?? []).filter((f): f is File => f instanceof File);
  if (!files.length) throw badRequest('Send the file in a "file" form field');
  const backendId = typeof form.backendId === 'string' ? form.backendId : undefined;
  const out = [];
  for (const f of files) out.push(await createUpload(c.get('user'), f.stream(), { filename: f.name || 'file', mime: f.type, backendId }));
  return c.json(out.length === 1 ? out[0] : out);
});

route(
  content,
  { method: 'post', path: '/uploads/from-url', tag: 'Uploads', summary: 'Download a URL into a post as an attachment (async)', body: z.object({ url: z.string().url(), postId: z.string().uuid(), backendId: z.string().uuid().optional() }) },
  async (c, { body }) => {
    const user = c.get('user');
    const p = await posts.loadVisiblePost(user, body.postId);
    if (p.owner_id !== user.timelineId) throw new HTTPException(403, { message: 'Not your post' });
    await queueUrlImport(user, body.url, { postId: body.postId, backendId: body.backendId });
    return { ok: true, queued: true };
  },
);

route(content, { method: 'get', path: '/attachments/{id}', tag: 'Uploads', summary: 'Attachment status (processing / ready) and URLs', params: idParam }, async (c, { params }) => {
  const a = await loadAttachment(params.id);
  const user = c.get('user');
  if (a.owner_id !== user.timelineId) {
    if (!a.post_id) throw new HTTPException(404, { message: 'File not found' });
    await posts.loadVisiblePost(user, a.post_id);
  }
  return serializeAttachment(a);
});

// ------------------------------- categories & tags -------------------------------

route(content, { method: 'get', path: '/categories', tag: 'Categories', summary: 'List categories (yours + shared timelines)' }, (c) => misc.listCategories(c.get('user')));

const categoryBody = z.object({
  name: z.string().min(1).max(60),
  color: z.string().max(20).optional(),
  icon: z.string().max(40).optional(),
  isPrivate: z.boolean().optional().describe('Private categories are never shown to people you share your timeline with'),
  sort: z.number().int().optional(),
});

route(content, { method: 'post', path: '/categories', tag: 'Categories', summary: 'Create a category', body: categoryBody }, async (c, { body }) => {
  const user = c.get('user');
  const [row] = await sql`
    INSERT INTO categories (owner_id, name, color, icon, is_private, sort)
    VALUES (${user.timelineId}, ${body.name}, ${body.color ?? '#64748b'}, ${body.icon ?? 'folder'}, ${body.isPrivate ?? false}, ${body.sort ?? 100})
    ON CONFLICT (owner_id, lower(name)) DO NOTHING RETURNING id`;
  if (!row) throw badRequest('A category with that name exists');
  return (await misc.listCategories(user)).find((x) => x.id === row.id);
});

route(content, { method: 'patch', path: '/categories/{id}', tag: 'Categories', summary: 'Edit a category', params: idParam, body: categoryBody.partial() }, async (c, { params, body }) => {
  const user = c.get('user');
  const [cur] = await sql`SELECT * FROM categories WHERE id = ${params.id} AND owner_id = ${user.timelineId}`;
  if (!cur) throw new HTTPException(404, { message: 'Category not found' });
  await sql`UPDATE categories SET name = ${body.name ?? cur.name}, color = ${body.color ?? cur.color}, icon = ${body.icon ?? cur.icon},
            is_private = ${body.isPrivate ?? cur.is_private}, sort = ${body.sort ?? cur.sort} WHERE id = ${params.id}`;
  return (await misc.listCategories(user)).find((x) => x.id === params.id);
});

route(content, { method: 'delete', path: '/categories/{id}', tag: 'Categories', summary: 'Delete a category (its posts become uncategorised)', params: idParam }, async (c, { params }) => {
  const user = c.get('user');
  const r = await sql`DELETE FROM categories WHERE id = ${params.id} AND owner_id = ${user.timelineId} RETURNING id`;
  if (!r.length) throw new HTTPException(404, { message: 'Category not found' });
  return { ok: true };
});

route(content, { method: 'get', path: '/tags', tag: 'Categories', summary: 'List tags with post counts', query: z.object({ q: z.string().optional() }) }, (c, { query }) =>
  misc.listTags(c.get('user'), query.q),
);

route(content, { method: 'post', path: '/tags/rename', tag: 'Categories', summary: 'Rename (or merge) a tag', body: z.object({ from: z.string(), to: z.string().min(1).max(60) }) }, async (c, { body }) => {
  const user = c.get('user');
  await sql.begin(async (tx) => {
    const [src] = await tx`SELECT id FROM tags WHERE owner_id = ${user.timelineId} AND lower(name) = ${body.from.toLowerCase()}`;
    if (!src) throw new HTTPException(404, { message: 'Tag not found' });
    const [dst] = await tx`SELECT id FROM tags WHERE owner_id = ${user.timelineId} AND lower(name) = ${body.to.toLowerCase()} AND id <> ${src.id}`;
    if (dst) {
      await tx`INSERT INTO post_tags (post_id, tag_id) SELECT post_id, ${dst.id} FROM post_tags WHERE tag_id = ${src.id} ON CONFLICT DO NOTHING`;
      await tx`DELETE FROM tags WHERE id = ${src.id}`;
    } else {
      await tx`UPDATE tags SET name = ${body.to} WHERE id = ${src.id}`;
    }
  });
  return { ok: true };
});

// ------------------------------- reminders -------------------------------

const reminderBody = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(5000).optional(),
  dueAt: z.string().describe('ISO 8601 with timezone, e.g. 2026-10-20T09:00:00+01:00'),
  repeat: z.enum(['daily', 'weekly', 'monthly', 'yearly']).nullable().optional(),
  postId: z.string().uuid().nullable().optional().describe('Optional post the reminder is about'),
});

route(content, { method: 'get', path: '/reminders', tag: 'Reminders', summary: 'List reminders', query: z.object({ includeDone: bool }) }, (c, { query }) =>
  misc.listReminders(c.get('user'), !!query.includeDone),
);
route(content, { method: 'post', path: '/reminders', tag: 'Reminders', summary: 'Create a reminder (push notification when due)', body: reminderBody }, (c, { body }) =>
  misc.createReminder(c.get('user'), body),
);
route(
  content,
  { method: 'patch', path: '/reminders/{id}', tag: 'Reminders', summary: 'Edit / snooze / cancel a reminder', params: idParam, body: reminderBody.partial().extend({ status: z.enum(['scheduled', 'cancelled']).optional() }) },
  (c, { params, body }) => misc.updateReminder(c.get('user'), params.id, body),
);
route(content, { method: 'delete', path: '/reminders/{id}', tag: 'Reminders', summary: 'Delete a reminder', params: idParam }, (c, { params }) =>
  misc.deleteReminder(c.get('user'), params.id),
);

// ------------------------------- notifications -------------------------------

route(
  content,
  { method: 'get', path: '/notifications', tag: 'Notifications', summary: 'List notifications', query: z.object({ unread: bool, limit: z.coerce.number().int().min(1).max(200).optional() }) },
  async (c, { query }) => {
    const user = c.get('user');
    const rows = await sql`
      SELECT n.*, u.name AS actor_name, u.kind AS actor_kind, u.avatar_color AS actor_color, u.avatar_v AS actor_avatar_v FROM notifications n
      LEFT JOIN users u ON u.id = n.actor_id
      WHERE n.user_id = ${user.timelineId} ${query.unread ? sql`AND n.read_at IS NULL` : sql``}
      ORDER BY n.created_at DESC LIMIT ${query.limit ?? 50}`;
    return {
      unread: await unreadCount(user.timelineId),
      items: rows.map((n) => ({
        id: n.id, type: n.type, title: n.title, body: n.body, postId: n.post_id, readAt: n.read_at, createdAt: n.created_at,
        actor: n.actor_id ? { id: n.actor_id, name: n.actor_name, kind: n.actor_kind, color: n.actor_color, avatarUrl: avatarUrl(n.actor_id, n.actor_avatar_v) } : null,
      })),
    };
  },
);

route(content, { method: 'get', path: '/notifications/count', tag: 'Notifications', summary: 'Unread notification count (bell badge)' }, async (c) => ({
  unread: await unreadCount(c.get('user').timelineId),
}));

route(
  content,
  { method: 'post', path: '/notifications/read', tag: 'Notifications', summary: 'Mark notifications read', body: z.object({ ids: z.array(z.string().uuid()).optional(), all: z.boolean().optional() }) },
  async (c, { body }) => {
    const user = c.get('user');
    if (body.all) await sql`UPDATE notifications SET read_at = now() WHERE user_id = ${user.timelineId} AND read_at IS NULL`;
    else if (body.ids?.length) await sql`UPDATE notifications SET read_at = now() WHERE user_id = ${user.timelineId} AND id = ANY(${body.ids}) AND read_at IS NULL`;
    return { unread: await unreadCount(user.timelineId) };
  },
);

// ------------------------------- recycle bin -------------------------------

const trashParams = z.object({ type: z.enum(['post', 'comment', 'attachment']), id: z.string().uuid() });

route(content, { method: 'get', path: '/trash', tag: 'Recycle bin', summary: 'List deleted posts, comments and files' }, (c) => misc.listTrash(c.get('user')));
route(content, { method: 'post', path: '/trash/{type}/{id}/restore', tag: 'Recycle bin', summary: 'Restore an item', params: trashParams }, (c, { params }) =>
  misc.restoreFromTrash(c.get('user'), params.type, params.id),
);
route(content, { method: 'delete', path: '/trash/{type}/{id}', tag: 'Recycle bin', summary: 'Delete an item forever (needs "purge" scope)', params: trashParams }, (c, { params }) => {
  requireScope(c, 'purge');
  return misc.purgeFromTrash(c.get('user'), params.type, params.id);
});
route(content, { method: 'delete', path: '/trash', tag: 'Recycle bin', summary: 'Empty the recycle bin (needs "purge" scope)' }, (c) => {
  requireScope(c, 'purge');
  return misc.emptyTrash(c.get('user'));
});

// ------------------------------- agent tasks -------------------------------

route(content, { method: 'get', path: '/agent-tasks', tag: 'Agents', summary: 'Tasks your agents run (agents see their own)' }, (c) => misc.listAgentTasks(c.get('user')));
route(
  content,
  {
    method: 'put',
    path: '/agent-tasks',
    tag: 'Agents',
    summary: 'Agents: register a task / report a run (upsert by name)',
    body: z.object({
      name: z.string().min(1).max(120).describe('e.g. "Watch instagram.com/@nasa"'),
      description: z.string().max(2000).optional(),
      schedule: z.string().max(120).optional().describe('Human readable, e.g. "every 15 minutes"'),
      status: z.enum(['active', 'paused', 'error']).optional(),
      lastResult: z.string().max(2000).optional().describe('e.g. "2 new videos posted"'),
    }),
  },
  (c, { body }) => misc.upsertAgentTask(c.get('user'), body),
);
route(content, { method: 'delete', path: '/agent-tasks/{id}', tag: 'Agents', summary: 'Remove a task', params: idParam }, (c, { params }) =>
  misc.deleteAgentTask(c.get('user'), params.id),
);
