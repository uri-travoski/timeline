import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { sql } from '../db.ts';
import { config } from '../config.ts';
import type { AuthUser } from '../lib/auth.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { enqueue } from '../lib/jobs.ts';
import { guessMime, kindFromMime, mediaBase, mediaDirFor } from '../lib/media-url.ts';
import { downloadUrl, makeHls, makeThumbs, probe } from '../lib/media.ts';
import { driverFor, pickBackend } from '../storage/index.ts';
import type { ByteRange } from '../storage/types.ts';

export function serializeAttachment(a: any) {
  const base = mediaBase(a.id);
  const ready = a.media_status === 'ready';
  return {
    id: a.id,
    postId: a.post_id,
    filename: a.filename,
    mime: a.mime,
    kind: a.kind,
    size: Number(a.size),
    width: a.width,
    height: a.height,
    duration: a.duration,
    status: a.status,
    mediaStatus: a.media_status,
    error: a.error,
    url: `${base}/original`,
    downloadUrl: `${base}/original?download=1`,
    thumbUrl: a.has_thumb ? `${base}/thumb.webp` : null,
    posterUrl: a.has_thumb && a.kind === 'video' ? `${base}/poster.jpg` : null,
    // HLS appears once transcoding is done; until then players fall back to the original file.
    hlsUrl: a.has_hls && ready ? `${base}/hls/master.m3u8` : null,
  };
}

const safeName = (s: string) => s.replace(/[/\\\0]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 200) || 'file';

function storageKey(ownerId: string, attachmentId: string, filename: string) {
  const d = new Date();
  const ext = path.extname(filename).toLowerCase().replace(/[^.\w]/g, '').slice(0, 10);
  return `${ownerId}/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${attachmentId}${ext}`;
}

/** Stream a request body to the spool dir, then register the attachment and queue processing. */
export async function createUpload(
  user: AuthUser,
  body: ReadableStream<Uint8Array> | Readable,
  opts: { filename: string; mime?: string | null; backendId?: string | null },
) {
  const filename = safeName(opts.filename);
  const mime = guessMime(filename, opts.mime);
  const backend = await pickBackend(user.timelineId, opts.backendId);
  await fsp.mkdir(config.spoolDir, { recursive: true });
  const spool = path.join(config.spoolDir, `${crypto.randomUUID()}${path.extname(filename).slice(0, 10)}`);
  const hash = crypto.createHash('sha256');
  let size = 0;
  const meter = new Transform({
    transform(chunk, _enc, cb) {
      size += chunk.length;
      if (size > config.maxUploadBytes) return cb(new Error('File is too large'));
      hash.update(chunk);
      cb(null, chunk);
    },
  });
  const src = body instanceof Readable ? body : Readable.fromWeb(body as any);
  try {
    await pipeline(src, meter, fs.createWriteStream(spool));
  } catch (e) {
    await fsp.rm(spool, { force: true });
    throw badRequest((e as Error).message);
  }
  if (size === 0) {
    await fsp.rm(spool, { force: true });
    throw badRequest('Empty upload');
  }
  return registerSpooled(user, { spool, filename, mime, size, sha256: hash.digest('hex'), backendId: backend.id });
}

async function registerSpooled(
  user: AuthUser,
  f: { spool: string; filename: string; mime: string; size: number; sha256: string; backendId: string; postId?: string | null },
) {
  const kind = kindFromMime(f.mime, f.filename);
  const [a] = await sql`
    INSERT INTO attachments (owner_id, uploaded_by, post_id, filename, mime, kind, size, sha256, backend_id, spool_path, media_status)
    VALUES (${user.timelineId}, ${user.id}, ${f.postId ?? null}, ${f.filename}, ${f.mime}, ${kind}, ${f.size}, ${f.sha256},
            ${f.backendId}, ${f.spool}, ${kind === 'image' || kind === 'video' ? 'processing' : 'none'})
    RETURNING *`;
  await enqueue('process_attachment', { attachmentId: a.id });
  return serializeAttachment(a);
}

/** Queue a download of a URL (yt-dlp for Instagram/YouTube/TikTok pages, plain fetch for files). */
export async function queueUrlImport(user: AuthUser, url: string, opts: { postId?: string; backendId?: string | null }) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) throw new Error();
  } catch {
    throw badRequest('url must be an http(s) URL');
  }
  const backend = await pickBackend(user.timelineId, opts.backendId);
  await enqueue('import_url', { url, userId: user.id, timelineId: user.timelineId, postId: opts.postId ?? null, backendId: backend.id }, { maxAttempts: 3 });
}

// ------------------------------- worker side -------------------------------

export async function runImportUrl(payload: { url: string; userId: string; timelineId: string; postId: string | null; backendId: string }) {
  const dl = await downloadUrl(payload.url, config.spoolDir);
  const st = await fsp.stat(dl.file);
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(dl.file), hash);
  const fakeUser = { id: payload.userId, timelineId: payload.timelineId } as AuthUser;
  const att = await registerSpooled(fakeUser, {
    spool: dl.file,
    filename: safeName(dl.filename),
    mime: guessMime(dl.filename, dl.mime),
    size: st.size,
    sha256: hash.digest('hex'),
    backendId: payload.backendId,
    postId: payload.postId,
  });
  if (payload.postId) {
    // Fill in text the agent didn't provide, from the source page.
    const [p] = await sql`SELECT title, body, source_name FROM posts WHERE id = ${payload.postId}`;
    if (p) {
      await sql`UPDATE posts SET
                  title = ${p.title || (dl.title ?? '').slice(0, 200)},
                  body = ${p.body || (dl.description ?? '')},
                  source_name = ${p.source_name || (dl.uploader ?? '')}
                WHERE id = ${payload.postId}`;
    }
  }
  return att;
}

export async function runProcessAttachment(attachmentId: string) {
  const [a] = await sql`SELECT * FROM attachments WHERE id = ${attachmentId}`;
  if (!a) return;
  const spool: string | null = a.spool_path;
  const haveSpool = !!spool && fs.existsSync(spool);

  // 1) Store the original first, so the file is safe as early as possible.
  if (a.status !== 'stored') {
    if (!haveSpool) {
      await sql`UPDATE attachments SET status = 'failed', error = 'Upload was lost before it could be stored' WHERE id = ${a.id}`;
      return;
    }
    const driver = await driverFor(a.backend_id);
    const key = await driver.put({ key: storageKey(a.owner_id, a.id, a.filename), filePath: spool!, mime: a.mime, filename: a.filename, size: Number(a.size) });
    await sql`UPDATE attachments SET status = 'stored', storage_key = ${key}, error = NULL WHERE id = ${a.id}`;
  }

  // 2) Thumbnails / poster / HLS for images and videos.
  if ((a.kind === 'image' || a.kind === 'video') && a.media_status !== 'ready') {
    let src = haveSpool ? spool! : null;
    let temp: string | null = null;
    if (!src) {
      // Re-processing an already-stored file: fetch it back to a temp file.
      temp = path.join(config.spoolDir, `reprocess-${a.id}`);
      const driver = await driverFor(a.backend_id);
      const r = await driver.read(a.storage_key, Number(a.size));
      await pipeline(r.stream, fs.createWriteStream(temp));
      src = temp;
    }
    const out = mediaDirFor(a.id);
    try {
      const p = await probe(src);
      await sql`UPDATE attachments SET width = ${p.width ?? null}, height = ${p.height ?? null}, duration = ${p.duration ?? null} WHERE id = ${a.id}`;
      if (p.hasVideo) {
        await makeThumbs(src, out, a.kind, p);
        await sql`UPDATE attachments SET has_thumb = true WHERE id = ${a.id}`;
      }
      if (a.kind === 'video' && p.hasVideo) {
        await makeHls(src, out, p);
        await sql`UPDATE attachments SET has_hls = true WHERE id = ${a.id}`;
      }
      await sql`UPDATE attachments SET media_status = 'ready' WHERE id = ${a.id}`;
    } catch (e) {
      await sql`UPDATE attachments SET media_status = 'failed', error = ${String((e as Error).message).slice(0, 500)} WHERE id = ${a.id}`;
      console.error(`[media] ${a.id} failed:`, (e as Error).message);
    } finally {
      if (temp) await fsp.rm(temp, { force: true });
    }
  }

  // 3) Done: drop the spool copy.
  if (haveSpool) await fsp.rm(spool!, { force: true });
  await sql`UPDATE attachments SET spool_path = NULL WHERE id = ${a.id}`;
}

export async function runDeleteObject(attachmentId: string) {
  const [a] = await sql`SELECT * FROM attachments WHERE id = ${attachmentId}`;
  if (!a) return;
  if (a.storage_key && a.backend_id) {
    const driver = await driverFor(a.backend_id);
    await driver.remove(a.storage_key);
  }
  if (a.spool_path) await fsp.rm(a.spool_path, { force: true });
  await fsp.rm(mediaDirFor(a.id), { recursive: true, force: true });
  await sql`DELETE FROM attachments WHERE id = ${a.id}`;
}

// ------------------------------- serving -------------------------------

export function parseRange(header: string | undefined, size: number): ByteRange | undefined | 'invalid' {
  if (!header) return undefined;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return undefined;
  let start: number;
  let end: number | undefined;
  if (m[1] === '') {
    const suffix = Number(m[2]);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : undefined;
  }
  if (start >= size || (end !== undefined && end < start)) return 'invalid';
  return { start, end };
}

export async function loadAttachment(id: string) {
  const [a] = await sql`SELECT * FROM attachments WHERE id = ${id}`;
  if (!a) throw notFound('File not found');
  return a;
}
