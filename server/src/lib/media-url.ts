import path from 'node:path';
import { config } from '../config.ts';
import { sign, verifySig } from './crypto.ts';

const WEEK = 7 * 86400;

/**
 * Media is served from /m/<exp>/<sig>/<attachmentId>/<file>. The signature sits in the
 * path (not the query string) so relative URLs inside HLS playlists keep working, and
 * the expiry is bucketed per week so URLs stay stable and the HTTP cache keeps hitting.
 */
export function mediaBase(attachmentId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const exp = (Math.floor(now / WEEK) + 2) * WEEK;
  // Relative on purpose: the same server is reached via LAN IP, localhost or a public domain.
  return `/m/${exp}/${sign(`${attachmentId}.${exp}`)}/${attachmentId}`;
}

export function verifyMedia(exp: string, sig: string, attachmentId: string): boolean {
  if (Number(exp) < Date.now() / 1000) return false;
  return verifySig(`${attachmentId}.${exp}`, sig);
}

export function mediaDirFor(attachmentId: string): string {
  return path.join(config.mediaDir, attachmentId.slice(-2), attachmentId);
}

export function kindFromMime(mime: string, filename = ''): 'image' | 'video' | 'audio' | 'pdf' | 'document' | 'archive' | 'other' {
  const m = mime.toLowerCase();
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/') || ['mp4', 'mov', 'mkv', 'webm', 'm4v', 'avi'].includes(ext)) return 'video';
  if (m.startsWith('audio/') || ['mp3', 'm4a', 'wav', 'flac', 'ogg', 'opus'].includes(ext)) return 'audio';
  if (m === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (/zip|x-7z|x-rar|x-tar|gzip|x-bzip/.test(m) || ['zip', '7z', 'rar', 'tar', 'gz', 'tgz'].includes(ext)) return 'archive';
  if (
    m.startsWith('text/') ||
    /msword|officedocument|opendocument|rtf|csv|json|xml|markdown|presentation|spreadsheet/.test(m) ||
    ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'txt', 'md', 'csv', 'rtf'].includes(ext)
  )
    return 'document';
  return 'other';
}

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', avif: 'image/avif',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', m4v: 'video/x-m4v',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac',
  pdf: 'application/pdf', zip: 'application/zip', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

// Content types that say nothing about the file (curl's default for --data-binary is form-urlencoded).
const GENERIC = /^(application\/(octet-stream|x-www-form-urlencoded|binary)|multipart\/|text\/plain$|$)/;

export function guessMime(filename: string, given?: string | null): string {
  const g = (given ?? '').split(';')[0].trim().toLowerCase();
  const byExt = EXT_MIME[filename.toLowerCase().split('.').pop() ?? ''];
  if (!g || GENERIC.test(g)) return byExt ?? (g === 'text/plain' ? g : 'application/octet-stream');
  return g;
}
