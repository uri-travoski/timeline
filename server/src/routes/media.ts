import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { verifyMedia, mediaDirFor } from '../lib/media-url.ts';
import { loadAttachment, parseRange } from '../services/attachments.ts';
import { driverFor } from '../storage/index.ts';
import { LocalDriver } from '../storage/local.ts';

/** Signed, cookie-less media serving: /m/<exp>/<sig>/<attachmentId>/<file>. */
export const media = new Hono();

const TYPES: Record<string, string> = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.m4s': 'video/iso.segment',
  '.mp4': 'video/mp4',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
};

const web = (s: Readable) => Readable.toWeb(s) as unknown as ReadableStream;

media.get('/:exp/:sig/:id/*', async (c) => {
  const { exp, sig, id } = c.req.param();
  if (!verifyMedia(exp, sig, id)) return c.text('Link expired', 403);
  const rest = c.req.path.split(`/${id}/`)[1] ?? '';

  if (rest === 'original') return serveOriginal(c, id);

  // Derivatives: thumbnails, posters and HLS. Immutable once written, so cache hard.
  const base = mediaDirFor(id);
  const file = path.resolve(base, rest);
  if (!file.startsWith(base + path.sep)) return c.text('Bad path', 400);
  let st;
  try {
    st = await fsp.stat(file);
  } catch {
    return c.text('Not found', 404);
  }
  c.header('Content-Type', TYPES[path.extname(file)] ?? 'application/octet-stream');
  c.header('Cache-Control', 'public, max-age=31536000, immutable');
  c.header('Content-Length', String(st.size));
  c.header('Access-Control-Allow-Origin', '*');
  return c.body(web(fs.createReadStream(file)));
});

async function serveOriginal(c: any, id: string) {
  const a = await loadAttachment(id);
  const size = Number(a.size);
  const download = c.req.query('download') === '1';
  const disposition = `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(a.filename)}`;

  // S3/B2/R2: hand the client a presigned URL so bytes don't flow through this server.
  if (a.status === 'stored' && a.backend_id) {
    const driver = await driverFor(a.backend_id);
    if (driver.directUrl && !download) {
      c.header('Cache-Control', 'private, max-age=3600');
      return c.redirect(await driver.directUrl(a.storage_key, a.filename, a.mime), 302);
    }
  }

  const range = parseRange(c.req.header('range'), size);
  if (range === 'invalid') {
    c.header('Content-Range', `bytes */${size}`);
    return c.body(null, 416);
  }

  let result;
  if (a.status !== 'stored' && a.spool_path && fs.existsSync(a.spool_path)) {
    // Not uploaded to the backend yet: serve the spooled copy.
    const dir = path.dirname(a.spool_path);
    result = await new LocalDriver(dir).read(path.basename(a.spool_path), size, range);
  } else if (a.status === 'stored') {
    result = await (await driverFor(a.backend_id)).read(a.storage_key, size, range);
  } else {
    return c.text(a.status === 'failed' ? 'This file failed to upload' : 'File is still uploading', a.status === 'failed' ? 410 : 503);
  }

  c.header('Content-Type', a.mime);
  c.header('Accept-Ranges', 'bytes');
  c.header('Content-Disposition', disposition);
  c.header('Cache-Control', 'private, max-age=86400');
  if (result.contentLength !== undefined) c.header('Content-Length', String(result.contentLength));
  if (result.contentRange) c.header('Content-Range', result.contentRange);
  return c.body(web(result.stream), result.status);
}
