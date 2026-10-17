import { randomBytes } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { sql } from '../db.ts';
import { config } from '../config.ts';
import { badRequest } from './errors.ts';
import { run } from './media.ts';
import { mediaBase, mediaDirFor } from './media-url.ts';

const MAX_BYTES = 12 * 1024 * 1024;

/** Signed, relative URL for a user's picture (served by the /m route like other media), or null when they have none. */
export function avatarUrl(userId: string, v: string | null | undefined): string | null {
  return v ? `${mediaBase(userId)}/avatar-${v}.webp` : null;
}

/** Centre-crops any image to a 256px square WebP and makes it the user's picture. */
export async function setAvatar(userId: string, body: ReadableStream, oldVersion: string | null): Promise<string> {
  await fsp.mkdir(config.spoolDir, { recursive: true });
  const tmp = path.join(config.spoolDir, `avatar-${randomBytes(6).toString('hex')}`);
  const dir = mediaDirFor(userId);
  const v = randomBytes(4).toString('hex');
  try {
    let size = 0;
    const limit = new Transform({
      transform(chunk, _enc, cb) {
        size += chunk.length;
        cb(size > MAX_BYTES ? new Error('Image too large (max 12 MB)') : null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(body as any), limit, createWriteStream(tmp));
    await fsp.mkdir(dir, { recursive: true });
    await run('ffmpeg', ['-y', '-v', 'error', '-i', tmp, '-frames:v', '1', '-vf', "crop='min(iw,ih)':'min(iw,ih)',scale=256:256", '-c:v', 'libwebp', '-quality', '85', path.join(dir, `avatar-${v}.webp`)], { timeoutMs: 30_000 });
  } catch (e) {
    await fsp.rm(path.join(dir, `avatar-${v}.webp`), { force: true });
    throw badRequest(`That file is not a usable image (${(e as Error).message.split('\n')[0].slice(0, 120)})`);
  } finally {
    await fsp.rm(tmp, { force: true });
  }
  if (oldVersion) await fsp.rm(path.join(dir, `avatar-${oldVersion}.webp`), { force: true });
  await sql`UPDATE users SET avatar_v = ${v} WHERE id = ${userId}`;
  return v;
}

export async function clearAvatar(userId: string, version: string | null) {
  if (version) await fsp.rm(path.join(mediaDirFor(userId), `avatar-${version}.webp`), { force: true });
  await sql`UPDATE users SET avatar_v = NULL WHERE id = ${userId}`;
}
