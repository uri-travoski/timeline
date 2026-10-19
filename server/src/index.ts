import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { logger } from 'hono/logger';
import { config } from './config.ts';
import { migrate } from './db.ts';
import { authenticate, enforceScopes, type AppEnv } from './lib/auth.ts';
import { content } from './routes/content.ts';
import { appUpdate } from './routes/appupdate.ts';
import { account, ensureAdmin, publicRoutes } from './routes/account.ts';
import { media } from './routes/media.ts';
import { handleMcp } from './mcp.ts';
import { ensureEnvBackends } from './storage/index.ts';
import { startWorker, stopWorker } from './jobs/worker.ts';
import { newApi } from './lib/api.ts';

for (const d of [config.dataDir, config.spoolDir, config.mediaDir, config.localStorageDir]) await fsp.mkdir(d, { recursive: true });
await migrate();
await ensureEnvBackends();
await ensureAdmin();

const app = new Hono<AppEnv>();
if (process.env.LOG_REQUESTS === 'true') app.use(logger());

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error('[http]', c.req.method, c.req.path, err);
  return c.json({ error: 'Internal server error' }, 500);
});

// API (Bearer token for apps/agents, cookie for the web app)
const api = newApi();
api.use('*', cors({ origin: (o) => o, credentials: true, allowHeaders: ['Authorization', 'Content-Type', 'X-Client', 'X-Api-Key'] }));
api.route('/', publicRoutes);
api.use('*', authenticate, enforceScopes);
api.route('/', content);
api.route('/', appUpdate);
api.route('/', account);

api.openAPIRegistry.registerComponent('securitySchemes', 'bearer', { type: 'http', scheme: 'bearer', description: 'API key (tlk_...) or session token' });
app.get('/api/openapi.json', (c) =>
  c.json(
    api.getOpenAPI31Document({
      openapi: '3.1.0',
      info: {
        title: 'Timeline API',
        version: '1.3.5',
        description:
          'Self-hosted timeline. Create an AI agent under Settings → AI agents to get an API key, then send it as `Authorization: Bearer tlk_...`. ' +
          'Upload files with `PUT /api/uploads?filename=x.mp4` (raw body), then reference the returned id in `attachmentIds` when creating a post. ' +
          'An MCP endpoint is available at `/mcp` with the same key.',
      },
      servers: [{ url: `${config.publicUrl}/api` }],
    }),
  ),
);
app.get('/api/docs', (c) =>
  c.html(`<!doctype html><html><head><title>Timeline API</title><meta charset="utf-8"/></head><body>
<script id="api-reference" data-url="/api/openapi.json"></script>
<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.25.0"></script></body></html>`),
);
app.route('/api', api);

app.all('/mcp', async (c) => handleMcp(c.req.raw));
app.route('/m', media);

// Web app (single-page app with client-side routing)
if (fs.existsSync(config.webDir)) {
  const indexPath = path.join(config.webDir, 'index.html');
  let indexHtml = { mtime: 0, html: '' };
  const readIndex = async () => {
    const st = await fsp.stat(indexPath);
    if (st.mtimeMs !== indexHtml.mtime) indexHtml = { mtime: st.mtimeMs, html: await fsp.readFile(indexPath, 'utf8') };
    return indexHtml.html;
  };
  app.use('/assets/*', async (c, next) => {
    await next();
    if (c.res.status === 200) c.header('Cache-Control', 'public, max-age=31536000, immutable');
  });
  app.use('*', serveStatic({ root: path.relative(process.cwd(), config.webDir) || '.' }));
  // A missing hashed asset (e.g. an old tab after an upgrade) must 404, not get the app page.
  app.get('/assets/*', (c) => c.text('Not found', 404));
  app.get('*', async (c) => {
    if (c.req.path.startsWith('/api/')) return c.json({ error: 'Not found' }, 404);
    c.header('Cache-Control', 'no-cache');
    return c.html(await readIndex());
  });
} else {
  app.get('/', (c) => c.text(`Timeline API is running. Web app not built (expected at ${config.webDir}).`));
}

if (config.workerInProcess) startWorker();

const server = serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, (info) => {
  console.log(`[http] Timeline listening on http://0.0.0.0:${info.port} (public URL ${config.publicUrl})`);
});

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    stopWorker();
    server.close();
    setTimeout(() => process.exit(0), 2000);
  });
}
