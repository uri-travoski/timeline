import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { config } from '../config.ts';

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 32, SCRYPT);
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored?.startsWith('scrypt$')) return false;
  const [, saltB64, keyB64] = stored.split('$');
  const expected = Buffer.from(keyB64, 'base64url');
  const key = await scrypt(password, Buffer.from(saltB64, 'base64url'), expected.length, SCRYPT);
  return crypto.timingSafeEqual(key, expected);
}

export function randomToken(prefix = ''): string {
  return prefix + crypto.randomBytes(32).toString('base64url');
}

/** Tokens and API keys are stored as keyed hashes so a DB leak doesn't leak credentials. */
export function tokenHash(token: string): string {
  return crypto.createHmac('sha256', config.appSecret).update(token).digest('base64url');
}

const encKey = crypto.createHash('sha256').update(`enc:${config.appSecret}`).digest();

export function encrypt(value: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
}

export function decrypt<T = any>(blob: string): T {
  const [iv, tag, data] = blob.split('.').map((s) => Buffer.from(s, 'base64url'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', encKey, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'));
}

/** HMAC signature for short, URL-safe signed values (media URLs, OAuth state). */
export function sign(value: string): string {
  return crypto.createHmac('sha256', config.appSecret).update(`sig:${value}`).digest('base64url').slice(0, 22);
}

export function verifySig(value: string, sig: string): boolean {
  const expected = Buffer.from(sign(value));
  const got = Buffer.from(sig);
  return expected.length === got.length && crypto.timingSafeEqual(expected, got);
}
