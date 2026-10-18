import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import { sql } from './db.ts';
import { resolveToken, type AuthUser, type Scope } from './lib/auth.ts';
import * as posts from './services/posts.ts';
import * as misc from './services/misc.ts';
import { queueUrlImport } from './services/attachments.ts';

const text = (data: unknown) => ({ content: [{ type: 'text' as const, text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] });

function need(user: AuthUser, scope: Scope) {
  if (!user.scopes.includes(scope)) throw new Error(`This API key is missing the "${scope}" scope`);
}

/** Trim posts for LLM context: drop URLs nobody needs and long bodies. */
function slim(p: any) {
  return {
    id: p.id, kind: p.kind, timeline: p.timeline.name, title: p.title || undefined, body: p.body.length > 1500 ? p.body.slice(0, 1500) + '…' : p.body,
    category: p.category?.name ?? null, tags: p.tags, author: p.author?.name, authorKind: p.author?.kind,
    source: p.source, sourceName: p.sourceName || undefined, sourceUrl: p.sourceUrl || undefined, postedAt: p.postedAt,
    isRead: p.isRead, comments: p.commentCount,
    attachments: p.attachments.map((a: any) => ({ id: a.id, filename: a.filename, kind: a.kind, size: a.size, status: a.status, mediaStatus: a.mediaStatus })),
  };
}

function buildServer(user: AuthUser) {
  const server = new McpServer({ name: 'timeline', version: '1.3.2' }, {
    instructions:
      `You are connected to the Timeline of ${user.kind === 'agent' ? 'your owner' : user.name}. ` +
      'Posts you create appear on that timeline with your name and an "AI agent" badge, and notify the owner. ' +
      'Always set sourceUrl when posting something from the web: the server rejects duplicates, so you can safely re-check a source. ' +
      'Use report_task to record what you are monitoring and the result of each run.',
  });

  const filters = {
    q: z.string().optional().describe('Full-text search'),
    categories: z.array(z.string()).optional().describe('Category names'),
    tags: z.array(z.string()).optional(),
    tagMode: z.enum(['any', 'all']).optional(),
    from: z.string().optional().describe('YYYY-MM-DD or ISO datetime'),
    to: z.string().optional().describe('YYYY-MM-DD or ISO datetime'),
    fileTypes: z.array(z.enum(['image', 'video', 'audio', 'pdf', 'document', 'archive', 'other', 'text'])).optional(),
    unread: z.boolean().optional(),
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(50).optional(),
  };

  server.registerTool('search_posts', { description: 'Search and filter the timeline (newest first). Returns posts and nextCursor.', inputSchema: filters, annotations: { readOnlyHint: true } }, async (args) => {
    need(user, 'read');
    const r = await posts.listPosts(user, { ...args, limit: args.limit ?? 20 });
    return text({ items: r.items.map(slim), nextCursor: r.nextCursor });
  });

  server.registerTool('get_post', { description: 'Get one post with its comments', inputSchema: { id: z.string() }, annotations: { readOnlyHint: true } }, async ({ id }) => {
    need(user, 'read');
    const p = await posts.getPost(user, id);
    const comments = await misc.listComments(user, id);
    return text({ ...slim(p), body: p.body, comments: comments.map((c) => ({ id: c.id, author: c.author.name, body: c.body, createdAt: c.createdAt })) });
  });

  server.registerTool(
    'create_post',
    {
      description: 'Create a text post (attach files with import_url_post or the REST upload API)',
      inputSchema: {
        body: z.string().describe('Post text, Markdown allowed'),
        title: z.string().optional(),
        category: z.string().optional().describe('Category name, see list_categories'),
        tags: z.array(z.string()).optional(),
        sourceName: z.string().optional().describe('Where this came from, e.g. "bbc.co.uk" or "instagram.com/@nasa"'),
        sourceUrl: z.string().optional().describe('Original URL. Re-posting the same URL fails, so duplicates are impossible.'),
        postedAt: z.string().optional().describe('ISO datetime to backdate'),
      },
    },
    async (args) => {
      need(user, 'write');
      return text(slim(await posts.createPost(user, args)));
    },
  );

  server.registerTool(
    'import_url_post',
    {
      description:
        'Create a post from a URL. The server downloads the video/image itself (Instagram, YouTube, TikTok, X, or any direct file URL), stores it, and builds the reels version. Fails with "Already posted" if this URL was posted before.',
      inputSchema: {
        url: z.string().url(),
        body: z.string().optional().describe('Caption; defaults to the source caption'),
        title: z.string().optional(),
        category: z.string().optional(),
        tags: z.array(z.string()).optional(),
        sourceName: z.string().optional(),
      },
    },
    async ({ url, ...rest }) => {
      need(user, 'write');
      const p = await posts.createPost(user, { ...rest, sourceUrl: url, sourceName: rest.sourceName ?? new URL(url).host });
      await queueUrlImport(user, url, { postId: p.id });
      return text({ ...slim(p), note: 'Media download queued; it appears on the post within a minute or two.' });
    },
  );

  server.registerTool('check_posted', { description: 'Check whether a source URL is already on the timeline', inputSchema: { url: z.string() }, annotations: { readOnlyHint: true } }, async ({ url }) => {
    need(user, 'read');
    const [p] = await sql`SELECT id, deleted_at FROM posts WHERE owner_id = ${user.timelineId} AND source_url = ${url}`;
    return text({ posted: !!p, postId: p?.id ?? null, deleted: !!p?.deleted_at });
  });

  server.registerTool(
    'update_post',
    {
      description: 'Edit a post (old version is kept in history)',
      inputSchema: { id: z.string(), body: z.string().optional(), title: z.string().optional(), category: z.string().nullable().optional(), tags: z.array(z.string()).optional() },
    },
    async ({ id, ...rest }) => {
      need(user, 'write');
      return text(slim(await posts.updatePost(user, id, rest)));
    },
  );

  server.registerTool('delete_post', { description: 'Move a post to the recycle bin (restorable)', inputSchema: { id: z.string() }, annotations: { destructiveHint: true } }, async ({ id }) => {
    need(user, 'delete');
    return text(await posts.deletePost(user, id));
  });

  server.registerTool('restore_post', { description: 'Restore a post from the recycle bin', inputSchema: { id: z.string() } }, async ({ id }) => {
    need(user, 'write');
    return text(slim(await posts.restorePost(user, id)));
  });

  server.registerTool('add_comment', { description: 'Comment on a post', inputSchema: { postId: z.string(), body: z.string(), parentId: z.string().optional() } }, async ({ postId, body, parentId }) => {
    need(user, 'write');
    return text(await misc.addComment(user, postId, body, parentId, user.kind === 'agent' ? 'agent' : 'api'));
  });

  server.registerTool('list_categories', { description: 'List categories you can post into', inputSchema: {}, annotations: { readOnlyHint: true } }, async () => {
    need(user, 'read');
    return text((await misc.listCategories(user)).filter((c) => c.mine).map((c) => ({ name: c.name, isPrivate: c.isPrivate, posts: c.postCount })));
  });

  server.registerTool('list_tags', { description: 'List tags with post counts', inputSchema: { q: z.string().optional() }, annotations: { readOnlyHint: true } }, async ({ q }) => {
    need(user, 'read');
    return text(await misc.listTags(user, q));
  });

  server.registerTool(
    'create_reminder',
    {
      description: "Remind the owner at a time: they get a push notification with sound and a reminder card on their timeline. Use the owner's timezone offset in dueAt.",
      inputSchema: {
        title: z.string(),
        body: z.string().optional(),
        dueAt: z.string().describe('ISO 8601 with offset, e.g. 2026-10-20T09:00:00+01:00'),
        repeat: z.enum(['daily', 'weekly', 'monthly', 'yearly']).optional(),
        postId: z.string().optional().describe('Optional post the reminder is about'),
      },
    },
    async (args) => {
      need(user, 'write');
      return text(await misc.createReminder(user, args));
    },
  );

  server.registerTool('list_reminders', { description: 'Upcoming reminders', inputSchema: {}, annotations: { readOnlyHint: true } }, async () => {
    need(user, 'read');
    return text(await misc.listReminders(user));
  });

  server.registerTool('cancel_reminder', { description: 'Cancel a reminder', inputSchema: { id: z.string() } }, async ({ id }) => {
    need(user, 'write');
    return text(await misc.updateReminder(user, id, { status: 'cancelled' }));
  });

  server.registerTool(
    'report_task',
    {
      description: 'Agents: record a task you run for the owner (e.g. "Watch instagram.com/@nasa") and the result of this run. Shown on the owner\'s Agents page.',
      inputSchema: {
        name: z.string(),
        description: z.string().optional(),
        schedule: z.string().optional().describe('e.g. "every 15 minutes"'),
        status: z.enum(['active', 'paused', 'error']).optional(),
        lastResult: z.string().optional().describe('e.g. "2 new videos posted"'),
      },
    },
    async (args) => {
      if (user.kind !== 'agent') return text('Only agent API keys report tasks.');
      return text(await misc.upsertAgentTask(user, args));
    },
  );

  return server;
}

/** Stateless Streamable HTTP endpoint: each request is authenticated by its API key. */
export async function handleMcp(req: Request): Promise<Response> {
  const auth = req.headers.get('authorization');
  const token = auth?.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : req.headers.get('x-api-key') ?? undefined;
  const user = await resolveToken(token);
  if (!user) throw new HTTPException(401, { message: 'Send your Timeline API key as "Authorization: Bearer tlk_..."' });
  const server = buildServer(user);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(req);
}
