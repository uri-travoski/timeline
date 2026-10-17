import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { config } from '../config.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import type { AppEnv } from '../lib/auth.ts';

/**
 * In-app updates for the Android app. The server looks at the newest GitHub Release of UPDATE_REPO and
 * hands the APK to the app itself, so a private repository works: only the server holds the GitHub token.
 */
export const appUpdate = new Hono<AppEnv>();

interface Latest { version: string; notes: string; publishedAt: string; size: number; assetApiUrl: string }
let cache: { at: number; value: Latest | null; error?: string } | null = null;

const gh = (url: string, accept = 'application/vnd.github+json') =>
  fetch(url, {
    headers: { accept, 'user-agent': 'timeline-server', ...(config.update.token ? { authorization: `Bearer ${config.update.token}` } : {}) },
    signal: AbortSignal.timeout(20_000),
  });

async function latest(refresh: boolean): Promise<NonNullable<typeof cache>> {
  if (!refresh && cache && Date.now() - cache.at < 10 * 60_000) return cache;
  try {
    const r = await gh(`https://api.github.com/repos/${config.update.repo}/releases/latest`);
    if (r.status === 404) throw new Error('No release found (or the server has no access to the repository)');
    if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
    const rel: any = await r.json();
    const asset = (rel.assets ?? []).find((a: any) => a.name === config.update.asset && a.state === 'uploaded');
    if (!asset) throw new Error(`The latest release has no ${config.update.asset} file`);
    cache = { at: Date.now(), value: { version: String(rel.tag_name).replace(/^v/i, ''), notes: String(rel.body ?? ''), publishedAt: rel.published_at, size: asset.size, assetApiUrl: asset.url } };
  } catch (e) {
    cache = { at: Date.now(), value: null, error: (e as Error).message };
  }
  return cache!;
}

/** 1.10.0 > 1.9.2: compare dot-separated numbers. */
export function isNewer(a: string, b: string) {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0;
  }
  return false;
}

appUpdate.get('/app/update', async (c) => {
  const current = (c.req.query('version') ?? '').slice(0, 30);
  if (!config.update.repo) return c.json({ configured: false });
  const l = await latest(c.req.query('refresh') === '1');
  if (!l.value) return c.json({ configured: true, current, error: l.error ?? 'Could not check for updates' });
  return c.json({
    configured: true,
    current,
    latest: l.value.version,
    updateAvailable: !!current && isNewer(l.value.version, current),
    notes: l.value.notes,
    size: l.value.size,
    publishedAt: l.value.publishedAt,
    downloadUrl: '/api/app/update/apk',
  });
});

appUpdate.get('/app/update/apk', async (c) => {
  if (!config.update.repo) throw badRequest('App updates are not set up on this server');
  const l = await latest(false);
  if (!l.value) throw notFound(l.error ?? 'No update available');
  // GitHub answers with a redirect to signed storage; undici drops the Authorization header on that cross-origin hop.
  const r = await gh(l.value.assetApiUrl, 'application/octet-stream');
  if (!r.ok || !r.body) throw notFound(`GitHub answered ${r.status} for the download`);
  c.header('Content-Type', 'application/vnd.android.package-archive');
  c.header('Content-Disposition', `attachment; filename="timeline-${l.value.version}.apk"`);
  c.header('Content-Length', String(l.value.size));
  return c.body(Readable.toWeb(Readable.fromWeb(r.body as any)) as unknown as ReadableStream);
});
