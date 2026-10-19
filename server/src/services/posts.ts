import type { Fragment } from 'postgres';
import { avatarUrl } from '../lib/avatar.ts';
import { sql } from '../db.ts';
import { readableTimelines, type AuthUser } from '../lib/auth.ts';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.ts';
import { notify } from '../lib/notify.ts';
import { enqueue } from '../lib/jobs.ts';
import { stripMarkdown } from '../lib/markdown.ts';
import { serializeAttachment } from './attachments.ts';

export const FILE_KINDS = ['image', 'video', 'audio', 'pdf', 'document', 'archive', 'other'] as const;

export interface FeedFilters {
  timelines?: string[];      // owner ids to combine; default: your own timeline
  categories?: string[];     // names or ids
  tags?: string[];
  tagMode?: 'any' | 'all';
  from?: string;             // ISO date/datetime (inclusive)
  to?: string;               // ISO date/datetime (inclusive, date-only = whole day)
  q?: string;
  fileTypes?: string[];      // image | video | audio | pdf | document | archive | other | text (= no attachments)
  authors?: string[];
  authorKind?: 'human' | 'agent';
  sources?: string[];
  unread?: boolean;
  order?: 'desc' | 'asc';
  cursor?: string;
  limit?: number;
}

const and = (parts: Fragment[]) => parts.reduce((a, b) => sql`${a} AND ${b}`);
const lower = (xs?: string[]) => (xs ?? []).map((x) => x.trim().toLowerCase()).filter(Boolean);

function parseDate(s: string, endOfDay: boolean): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T00:00:00Z`);
    if (endOfDay) d.setUTCDate(d.getUTCDate() + 1);
    return d;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw badRequest(`Invalid date: ${s}`);
  return d;
}

export function encodeCursor(postedAt: Date, id: string) {
  return Buffer.from(`${postedAt.toISOString()}|${id}`).toString('base64url');
}

function decodeCursor(c: string): [Date, string] {
  const [ts, id] = Buffer.from(c, 'base64url').toString('utf8').split('|');
  const d = new Date(ts);
  if (!id || Number.isNaN(d.getTime())) throw badRequest('Invalid cursor');
  return [d, id];
}

/**
 * WHERE clause for "posts this user may see, with these filters" (posts aliased p, categories c).
 * Wrapped in an object: postgres.js fragments are thenables, so returning one from an async
 * function would execute it as a query on its own.
 */
export async function feedWhere(user: AuthUser, f: FeedFilters): Promise<{ where: Fragment }> {
  const { own, shared } = await readableTimelines(user);
  const sharedIds = shared.map((s) => s.ownerId);
  const wanted = f.timelines?.length ? f.timelines : [own];
  const includeOwn = wanted.includes(own);
  const sharedWanted = wanted.filter((t) => sharedIds.includes(t));
  if (!includeOwn && sharedWanted.length === 0) throw forbidden('You have no access to that timeline');

  const vis: Fragment[] = [];
  if (includeOwn) vis.push(sql`p.owner_id = ${own}`);
  if (sharedWanted.length)
    vis.push(sql`(p.owner_id = ANY(${sharedWanted}) AND NOT coalesce(c.is_private, false) AND p.kind = 'post')`);

  const conds: Fragment[] = [
    sql`p.deleted_at IS NULL`,
    vis.length === 1 ? vis[0] : sql`(${vis[0]} OR ${vis[1]})`,
    // Reminder cards disappear once they are marked as read.
    sql`(p.kind = 'post' OR NOT EXISTS (SELECT 1 FROM post_reads r WHERE r.post_id = p.id AND r.user_id = ${user.timelineId}))`,
  ];

  const cats = lower(f.categories);
  if (cats.length) conds.push(sql`(c.id::text = ANY(${cats}) OR lower(c.name) = ANY(${cats}))`);

  const tags = lower(f.tags);
  if (tags.length) {
    if (f.tagMode === 'all') {
      conds.push(sql`(SELECT count(DISTINCT lower(t.name)) FROM post_tags pt JOIN tags t ON t.id = pt.tag_id
                      WHERE pt.post_id = p.id AND lower(t.name) = ANY(${tags})) = ${new Set(tags).size}`);
    } else {
      conds.push(sql`EXISTS (SELECT 1 FROM post_tags pt JOIN tags t ON t.id = pt.tag_id
                             WHERE pt.post_id = p.id AND lower(t.name) = ANY(${tags}))`);
    }
  }

  if (f.from) conds.push(sql`p.posted_at >= ${parseDate(f.from, false)}`);
  if (f.to) {
    const d = parseDate(f.to, true);
    conds.push(/^\d{4}-\d{2}-\d{2}$/.test(f.to) ? sql`p.posted_at < ${d}` : sql`p.posted_at <= ${d}`);
  }

  const q = f.q?.trim();
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
    conds.push(sql`(
      p.search @@ websearch_to_tsquery('simple', ${q})
      OR p.body ILIKE ${like} OR p.title ILIKE ${like}
      OR EXISTS (SELECT 1 FROM attachments a WHERE a.post_id = p.id AND a.deleted_at IS NULL AND a.filename ILIKE ${like})
      OR EXISTS (SELECT 1 FROM post_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.post_id = p.id AND t.name ILIKE ${like})
    )`);
  }

  const kinds = lower(f.fileTypes);
  if (kinds.length) {
    const real = kinds.filter((k) => k !== 'text');
    const parts: Fragment[] = [];
    if (real.length)
      parts.push(sql`EXISTS (SELECT 1 FROM attachments a WHERE a.post_id = p.id AND a.deleted_at IS NULL AND a.kind = ANY(${real}))`);
    if (kinds.includes('text'))
      parts.push(sql`NOT EXISTS (SELECT 1 FROM attachments a WHERE a.post_id = p.id AND a.deleted_at IS NULL)`);
    conds.push(parts.length === 1 ? parts[0] : sql`(${parts[0]} OR ${parts[1]})`);
  }

  if (f.authors?.length) conds.push(sql`p.author_id::text = ANY(${f.authors})`);
  if (f.authorKind) conds.push(sql`EXISTS (SELECT 1 FROM users au WHERE au.id = p.author_id AND au.kind = ${f.authorKind})`);
  if (f.sources?.length) conds.push(sql`p.source = ANY(${lower(f.sources)})`);
  if (f.unread) conds.push(sql`NOT EXISTS (SELECT 1 FROM post_reads r WHERE r.post_id = p.id AND r.user_id = ${user.timelineId})`);

  return { where: and(conds) };
}

export async function listPosts(user: AuthUser, f: FeedFilters) {
  const limit = Math.min(Math.max(f.limit ?? 20, 1), 100);
  const { where } = await feedWhere(user, f);
  const asc = f.order === 'asc';
  let cursorCond = sql`true`;
  if (f.cursor) {
    const [ts, id] = decodeCursor(f.cursor);
    cursorCond = asc ? sql`(p.posted_at, p.id) > (${ts}, ${id}::uuid)` : sql`(p.posted_at, p.id) < (${ts}, ${id}::uuid)`;
  }
  const rows = await sql`
    SELECT p.* FROM posts p LEFT JOIN categories c ON c.id = p.category_id
    WHERE ${where} AND ${cursorCond}
    ORDER BY ${asc ? sql`p.posted_at ASC, p.id ASC` : sql`p.posted_at DESC, p.id DESC`}
    LIMIT ${limit + 1}`;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: await serializePosts(user, page),
    nextCursor: rows.length > limit && last ? encodeCursor(last.posted_at, last.id) : null,
  };
}

/** Reels: video attachments across the filtered posts, newest first. */
export async function listReels(user: AuthUser, f: FeedFilters) {
  const limit = Math.min(Math.max(f.limit ?? 10, 1), 50);
  const { where } = await feedWhere(user, { ...f, fileTypes: undefined });
  let cursorCond = sql`true`;
  if (f.cursor) {
    const [ts, id] = decodeCursor(f.cursor);
    cursorCond = sql`(p.posted_at, a.id) < (${ts}, ${id}::uuid)`;
  }
  const rows = await sql`
    SELECT a.id AS attachment_id, p.* FROM attachments a
    JOIN posts p ON p.id = a.post_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE a.kind = 'video' AND a.deleted_at IS NULL AND a.status <> 'failed' AND ${where} AND ${cursorCond}
    ORDER BY p.posted_at DESC, a.id DESC
    LIMIT ${limit + 1}`;
  const page = rows.slice(0, limit);
  const posts = await serializePosts(user, dedupeById(page as any[]));
  const byId = new Map(posts.map((p) => [p.id, p]));
  const last = page[page.length - 1];
  return {
    items: page.map((r) => {
      const post = byId.get(r.id)!;
      return { attachment: post.attachments.find((a: any) => a.id === r.attachment_id)!, post };
    }),
    nextCursor: rows.length > limit && last ? encodeCursor(last.posted_at, last.attachment_id) : null,
  };
}

function dedupeById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}

export async function serializePosts(user: AuthUser, rows: any[]) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const userIds = [...new Set(rows.flatMap((r) => [r.author_id, r.owner_id]))];
  const catIds = [...new Set(rows.map((r) => r.category_id).filter(Boolean))];
  const refIds = [...new Set(rows.map((r) => r.ref_post_id).filter(Boolean))];
  const [atts, tags, users, cats, counts, reads, refs, shares] = await Promise.all([
    sql`SELECT * FROM attachments WHERE post_id = ANY(${ids}) AND deleted_at IS NULL ORDER BY sort, created_at`,
    sql`SELECT pt.post_id, t.name FROM post_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.post_id = ANY(${ids}) ORDER BY t.name`,
    sql`SELECT u.id, u.name, u.kind, u.avatar_color, u.avatar_v, u.owner_id, o.name AS owner_name
        FROM users u LEFT JOIN users o ON o.id = u.owner_id WHERE u.id = ANY(${userIds})`,
    catIds.length ? sql`SELECT * FROM categories WHERE id = ANY(${catIds})` : Promise.resolve([] as any[]),
    sql`SELECT post_id, count(*)::int AS n FROM comments WHERE post_id = ANY(${ids}) AND deleted_at IS NULL GROUP BY post_id`,
    sql`SELECT post_id FROM post_reads WHERE user_id = ${user.timelineId} AND post_id = ANY(${ids})`,
    refIds.length ? sql`SELECT id, title, left(body, 200) AS body, deleted_at FROM posts WHERE id = ANY(${refIds})` : Promise.resolve([] as any[]),
    sql`SELECT owner_id, can_comment FROM timeline_shares WHERE viewer_id = ${user.timelineId} AND status = 'accepted'`,
  ]);
  const group = <T,>(xs: T[], key: (x: T) => string) => {
    const m = new Map<string, T[]>();
    for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
    return m;
  };
  const attsBy = group(atts as any[], (a) => a.post_id);
  const tagsBy = group(tags as any[], (t) => t.post_id);
  const userBy = new Map((users as any[]).map((u) => [u.id, u]));
  const catBy = new Map((cats as any[]).map((c) => [c.id, c]));
  const countBy = new Map((counts as any[]).map((c) => [c.post_id, c.n]));
  const readSet = new Set((reads as any[]).map((r) => r.post_id));
  const refBy = new Map((refs as any[]).map((r) => [r.id, r]));
  const shareBy = new Map((shares as any[]).map((s) => [s.owner_id, s]));

  return rows.map((p) => {
    const author = userBy.get(p.author_id);
    const owner = userBy.get(p.owner_id);
    const cat = p.category_id ? catBy.get(p.category_id) : null;
    const mine = p.owner_id === user.timelineId;
    const ref = p.ref_post_id ? refBy.get(p.ref_post_id) : null;
    return {
      id: p.id,
      kind: p.kind,
      timeline: { id: p.owner_id, name: owner?.name ?? '', mine },
      title: p.title,
      body: p.body,
      category: cat ? { id: cat.id, name: cat.name, color: cat.color, icon: cat.icon, isPrivate: cat.is_private } : null,
      tags: (tagsBy.get(p.id) ?? []).map((t: any) => t.name),
      author: author
        ? { id: author.id, name: author.name, kind: author.kind, color: author.avatar_color, avatarUrl: avatarUrl(author.id, author.avatar_v), ownerName: author.owner_name ?? null }
        : null,
      source: p.source,
      sourceName: p.source_name,
      sourceUrl: p.source_url,
      sourceMeta: p.source_meta,
      postedAt: p.posted_at,
      createdAt: p.created_at,
      editedAt: p.edited_at,
      deletedAt: p.deleted_at,
      isRead: readSet.has(p.id),
      commentCount: countBy.get(p.id) ?? 0,
      attachments: (attsBy.get(p.id) ?? []).map(serializeAttachment),
      refPost: ref && !ref.deleted_at ? { id: ref.id, title: ref.title, snippet: stripMarkdown(ref.body) } : null,
      permissions: {
        canEdit: mine && user.scopes.includes('write'),
        canDelete: mine && user.scopes.includes('delete'),
        canComment: user.scopes.includes('write') && (mine || !!shareBy.get(p.owner_id)?.can_comment),
      },
    };
  });
}

export type PostDTO = Awaited<ReturnType<typeof serializePosts>>[number];

/** Load a post the user may see (throws 404 otherwise). */
export async function loadVisiblePost(user: AuthUser, id: string, opts: { includeDeleted?: boolean } = {}) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Post not found');
  const [p] = await sql`SELECT p.*, c.is_private FROM posts p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ${id}`;
  if (!p || (p.deleted_at && !opts.includeDeleted)) throw notFound('Post not found');
  if (p.owner_id !== user.timelineId) {
    const [share] = await sql`SELECT can_comment FROM timeline_shares WHERE owner_id = ${p.owner_id} AND viewer_id = ${user.timelineId} AND status = 'accepted'`;
    if (!share || p.is_private || p.kind !== 'post' || p.deleted_at) throw notFound('Post not found');
    p.share_can_comment = share.can_comment;
  }
  return p;
}

export async function getPost(user: AuthUser, id: string) {
  const p = await loadVisiblePost(user, id, { includeDeleted: true });
  if (p.deleted_at && p.owner_id !== user.timelineId) throw notFound('Post not found');
  return (await serializePosts(user, [p]))[0];
}

async function ownPost(user: AuthUser, id: string, opts: { includeDeleted?: boolean } = {}) {
  const p = await loadVisiblePost(user, id, opts);
  if (p.owner_id !== user.timelineId) throw forbidden('You can only change posts on your own timeline');
  return p;
}

async function resolveCategory(ownerId: string, cat: string | null | undefined): Promise<string | null | undefined> {
  if (cat === undefined) return undefined;
  if (cat === null || cat === '') return null;
  const [row] = await sql`SELECT id FROM categories WHERE owner_id = ${ownerId} AND (id::text = ${cat} OR lower(name) = ${cat.toLowerCase()})`;
  if (!row) {
    const all = await sql`SELECT name FROM categories WHERE owner_id = ${ownerId} ORDER BY sort, name`;
    throw badRequest(`Unknown category "${cat}". Available: ${all.map((c) => c.name).join(', ')}`);
  }
  return row.id;
}

async function setTags(tx: any, ownerId: string, postId: string, names: string[]) {
  const clean = [...new Map(names.map((n) => n.trim().replace(/^#/, '')).filter(Boolean).map((n) => [n.toLowerCase(), n.slice(0, 60)])).values()];
  await tx`DELETE FROM post_tags WHERE post_id = ${postId}`;
  if (!clean.length) return;
  for (const name of clean) {
    await tx`INSERT INTO tags (owner_id, name) VALUES (${ownerId}, ${name}) ON CONFLICT (owner_id, lower(name)) DO NOTHING`;
  }
  await tx`INSERT INTO post_tags (post_id, tag_id)
           SELECT ${postId}, id FROM tags WHERE owner_id = ${ownerId} AND lower(name) = ANY(${clean.map((n) => n.toLowerCase())})
           ON CONFLICT DO NOTHING`;
}

async function attach(tx: any, ownerId: string, postId: string, attachmentIds: string[], startSort = 0) {
  if (!attachmentIds.length) return;
  const rows = await tx`SELECT id, post_id FROM attachments WHERE id = ANY(${attachmentIds}) AND owner_id = ${ownerId} AND deleted_at IS NULL`;
  if (rows.length !== new Set(attachmentIds).size) throw badRequest('Some attachments were not found (upload them first, to your own timeline)');
  if (rows.some((r: any) => r.post_id && r.post_id !== postId)) throw badRequest('An attachment already belongs to another post');
  let i = startSort;
  for (const id of attachmentIds) await tx`UPDATE attachments SET post_id = ${postId}, sort = ${i++} WHERE id = ${id}`;
}

export interface CreatePostInput {
  title?: string;
  body?: string;
  category?: string | null;
  tags?: string[];
  postedAt?: string;
  attachmentIds?: string[];
  source?: string;
  sourceName?: string;
  sourceUrl?: string | null;
  sourceMeta?: Record<string, unknown>;
}

export function defaultSource(user: AuthUser, client?: string) {
  if (user.kind === 'agent') return 'agent';
  if (user.via === 'apikey') return 'api';
  return ['android', 'ios', 'web'].includes(client ?? '') ? client! : 'web';
}

export async function createPost(user: AuthUser, input: CreatePostInput, client?: string) {
  const ownerId = user.timelineId;
  if (!input.body?.trim() && !input.title?.trim() && !input.attachmentIds?.length && !input.sourceUrl)
    throw badRequest('A post needs text or at least one attachment');
  const categoryId = await resolveCategory(ownerId, input.category ?? null);
  if (input.sourceUrl) {
    const [dup] = await sql`SELECT id FROM posts WHERE owner_id = ${ownerId} AND source_url = ${input.sourceUrl}`;
    if (dup) throw conflict(`Already posted: ${dup.id}`);
  }
  const postedAt = input.postedAt ? new Date(input.postedAt) : new Date();
  if (Number.isNaN(postedAt.getTime())) throw badRequest('Invalid postedAt');

  const id = await sql.begin(async (tx) => {
    const [p] = await tx`
      INSERT INTO posts (owner_id, author_id, category_id, title, body, source, source_name, source_url, source_meta, posted_at)
      VALUES (${ownerId}, ${user.id}, ${categoryId ?? null}, ${input.title?.trim() ?? ''}, ${input.body ?? ''},
              ${(input.source ?? defaultSource(user, client)).slice(0, 30)}, ${input.sourceName ?? ''},
              ${input.sourceUrl ?? null}, ${tx.json((input.sourceMeta ?? {}) as any)}, ${postedAt})
      RETURNING id`;
    await setTags(tx, ownerId, p.id, input.tags ?? []);
    await attach(tx, ownerId, p.id, input.attachmentIds ?? []);
    // Your own posts start as read; agent posts are new to you.
    if (user.kind === 'human') await tx`INSERT INTO post_reads (user_id, post_id) VALUES (${ownerId}, ${p.id}) ON CONFLICT DO NOTHING`;
    return p.id as string;
  });

  if (user.id !== ownerId) {
    await notify({
      userId: ownerId,
      type: 'agent_post',
      postId: id,
      actorId: user.id,
      title: `${user.name} posted`,
      body: (input.title || input.body || input.sourceName || 'New post').slice(0, 140),
    });
  }
  return getPost(user, id);
}

export interface UpdatePostInput {
  title?: string;
  body?: string;
  category?: string | null;
  tags?: string[];
  postedAt?: string;
  addAttachmentIds?: string[];
  removeAttachmentIds?: string[];
  attachmentOrder?: string[];
}

export async function updatePost(user: AuthUser, id: string, input: UpdatePostInput) {
  const p = await ownPost(user, id);
  const categoryId = await resolveCategory(p.owner_id, input.category);
  await sql.begin(async (tx) => {
    const oldTags = await tx`SELECT t.name FROM post_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.post_id = ${id}`;
    await tx`INSERT INTO post_revisions (post_id, title, body, category_id, tags, edited_by)
             VALUES (${id}, ${p.title}, ${p.body}, ${p.category_id}, ${oldTags.map((t) => t.name)}, ${user.id})`;
    const postedAt = input.postedAt ? new Date(input.postedAt) : undefined;
    if (postedAt && Number.isNaN(postedAt.getTime())) throw badRequest('Invalid postedAt');
    await tx`
      UPDATE posts SET
        title = ${input.title ?? p.title},
        body = ${input.body ?? p.body},
        category_id = ${categoryId === undefined ? p.category_id : categoryId},
        posted_at = ${postedAt ?? p.posted_at},
        edited_at = now(), updated_at = now()
      WHERE id = ${id}`;
    if (input.tags) await setTags(tx, p.owner_id, id, input.tags);
    if (input.removeAttachmentIds?.length)
      await tx`UPDATE attachments SET deleted_at = now() WHERE post_id = ${id} AND id = ANY(${input.removeAttachmentIds})`;
    if (input.addAttachmentIds?.length) {
      const [{ n }] = await tx`SELECT coalesce(max(sort), -1)::int + 1 AS n FROM attachments WHERE post_id = ${id}`;
      await attach(tx, p.owner_id, id, input.addAttachmentIds, n);
    }
    if (input.attachmentOrder?.length) {
      let i = 0;
      for (const aid of input.attachmentOrder) await tx`UPDATE attachments SET sort = ${i++} WHERE id = ${aid} AND post_id = ${id}`;
    }
  });
  return getPost(user, id);
}

export async function listRevisions(user: AuthUser, id: string) {
  await ownPost(user, id, { includeDeleted: true });
  return sql`SELECT r.id, r.title, r.body, r.tags, r.created_at AS "editedAt", u.name AS "editedBy"
             FROM post_revisions r LEFT JOIN users u ON u.id = r.edited_by WHERE r.post_id = ${id} ORDER BY r.created_at DESC`;
}

export async function deletePost(user: AuthUser, id: string) {
  await ownPost(user, id);
  await sql`UPDATE posts SET deleted_at = now(), deleted_by = ${user.id} WHERE id = ${id}`;
  return { ok: true, id, inRecycleBin: true };
}

export async function restorePost(user: AuthUser, id: string) {
  await ownPost(user, id, { includeDeleted: true });
  await sql`UPDATE posts SET deleted_at = NULL, deleted_by = NULL WHERE id = ${id}`;
  return getPost(user, id);
}

/** Permanently delete a post and its files (from the recycle bin). */
export async function purgePost(user: AuthUser, id: string) {
  const p = await ownPost(user, id, { includeDeleted: true });
  if (!p.deleted_at) throw badRequest('Move the post to the recycle bin first');
  await purgePostsByIds([id]);
  return { ok: true, id, purged: true };
}

export async function purgePostsByIds(ids: string[]) {
  if (!ids.length) return;
  const atts = await sql`SELECT id FROM attachments WHERE post_id = ANY(${ids})`;
  for (const a of atts) await enqueue('delete_object', { attachmentId: a.id });
  // Detach so the attachment rows survive until their files are deleted.
  await sql`UPDATE attachments SET post_id = NULL, deleted_at = coalesce(deleted_at, now()) WHERE post_id = ANY(${ids})`;
  await sql`DELETE FROM posts WHERE id = ANY(${ids})`;
}

export async function markRead(user: AuthUser, postIds: string[], read = true) {
  const ids = postIds.filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 500);
  if (!ids.length) return { ok: true, count: 0 };
  if (read) {
    await sql`INSERT INTO post_reads (user_id, post_id)
              SELECT ${user.timelineId}, id FROM posts WHERE id = ANY(${ids}) ON CONFLICT DO NOTHING`;
    // Reading a post also clears its notifications from the bell.
    await sql`UPDATE notifications SET read_at = now() WHERE user_id = ${user.timelineId} AND post_id = ANY(${ids}) AND read_at IS NULL`;
  } else {
    await sql`DELETE FROM post_reads WHERE user_id = ${user.timelineId} AND post_id = ANY(${ids})`;
  }
  return { ok: true, count: ids.length };
}
