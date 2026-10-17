import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.ts';

export function run(cmd: string, args: string[], opts: { timeoutMs?: number } = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => {
      stderr += d;
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });
    const timer = opts.timeoutMs ? setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs) : null;
    child.on('error', reject);
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited with ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

export interface Probe {
  width?: number;
  height?: number;
  duration?: number;
  fps?: number;
  hasAudio: boolean;
  hasVideo: boolean;
}

export async function probe(file: string): Promise<Probe> {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], {
    timeoutMs: 60_000,
  });
  const info = JSON.parse(stdout);
  const streams: any[] = info.streams ?? [];
  const v = streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1) ?? streams.find((s) => s.codec_type === 'video');
  let width = v?.width as number | undefined;
  let height = v?.height as number | undefined;
  // Phone videos are often stored landscape with a rotation flag; ffmpeg auto-rotates on decode.
  const rotation = Number(v?.side_data_list?.find((d: any) => d.rotation !== undefined)?.rotation ?? v?.tags?.rotate ?? 0);
  if (width && height && Math.abs(rotation) % 180 === 90) [width, height] = [height, width];
  const duration = Number(info.format?.duration ?? v?.duration);
  const [num, den] = String(v?.avg_frame_rate ?? v?.r_frame_rate ?? '0/1').split('/').map(Number);
  const fps = den ? num / den : undefined;
  return {
    width,
    height,
    fps: fps && Number.isFinite(fps) ? fps : undefined,
    duration: Number.isFinite(duration) && duration > 0 ? duration : undefined,
    hasAudio: streams.some((s) => s.codec_type === 'audio'),
    hasVideo: !!v,
  };
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Small WebP thumbnail (feed grid) and, for videos, a JPEG poster frame shown instantly in reels. */
export async function makeThumbs(src: string, outDir: string, kind: 'image' | 'video', p: Probe) {
  await fsp.mkdir(outDir, { recursive: true });
  const seek = kind === 'video' ? ['-ss', String(Math.min(0.5, (p.duration ?? 1) / 3))] : [];
  if (kind === 'video') {
    await run('ffmpeg', ['-y', '-v', 'error', ...seek, '-i', src, '-frames:v', '1', '-vf', "scale='min(1080,iw)':-2", '-q:v', '4', path.join(outDir, 'poster.jpg')], {
      timeoutMs: 120_000,
    });
  }
  await run(
    'ffmpeg',
    ['-y', '-v', 'error', ...seek, '-i', src, '-frames:v', '1', '-vf', "scale='min(720,iw)':-2", '-c:v', 'libwebp', '-quality', '78', path.join(outDir, 'thumb.webp')],
    { timeoutMs: 120_000 },
  );
}

const BITRATE: Record<number, [number, number]> = {
  // short side -> [video kbps, audio kbps]
  240: [400, 64],
  360: [750, 96],
  480: [1100, 96],
  540: [1500, 128],
  720: [2600, 128],
  1080: [4800, 160],
  1440: [8000, 160],
};

/**
 * Adaptive HLS ladder tuned for instant start in reels:
 *  - keyframe every second and 2-second segments, so the first frame needs only a small download;
 *  - players can switch quality at every segment boundary;
 *  - renditions sized by the *short* side, so portrait reels get proper 720p/1080p.
 */
export async function makeHls(src: string, outDir: string, p: Probe) {
  if (!p.width || !p.height) throw new Error('Video has no dimensions');
  const short = Math.min(p.width, p.height);
  let heights = config.hls.heights.filter((h) => h <= short);
  if (heights.length === 0) heights = [even(short)];
  const hlsDir = path.join(outDir, 'hls');
  await fsp.rm(hlsDir, { recursive: true, force: true });
  await fsp.mkdir(hlsDir, { recursive: true });

  const n = heights.length;
  const scale = (t: number) => {
    const f = t / short;
    return `${even(p.width! * f)}:${even(p.height! * f)}`;
  };
  const fpsCap = p.fps && p.fps > 31 ? 'fps=30,' : '';
  const filter = `[0:v]${fpsCap}split=${n}${heights.map((_, i) => `[s${i}]`).join('')};` + heights.map((t, i) => `[s${i}]scale=${scale(t)}:flags=bicubic,format=yuv420p[v${i}]`).join(';');

  const args = ['-y', '-v', 'error', '-i', src, '-filter_complex', filter];
  heights.forEach((t, i) => {
    const [vk, ak] = BITRATE[t] ?? [Math.round(t * 4), 128];
    args.push('-map', `[v${i}]`);
    if (p.hasAudio) args.push('-map', 'a:0');
    args.push(
      `-c:v:${i}`, 'libx264',
      `-b:v:${i}`, `${vk}k`,
      `-maxrate:v:${i}`, `${Math.round(vk * 1.3)}k`,
      `-bufsize:v:${i}`, `${vk * 2}k`,
    );
    if (p.hasAudio) args.push(`-c:a:${i}`, 'aac', `-b:a:${i}`, `${ak}k`, `-ac:a:${i}`, '2');
  });
  const streamMap = heights.map((_, i) => (p.hasAudio ? `v:${i},a:${i},name:${heights[i]}` : `v:${i},name:${heights[i]}`)).join(' ');
  args.push(
    '-preset', config.hls.preset,
    '-profile:v', 'high',
    '-force_key_frames', 'expr:gte(t,n_forced*1)',
    '-sc_threshold', '0',
    '-f', 'hls',
    '-hls_time', '2',
    '-hls_playlist_type', 'vod',
    '-hls_flags', 'independent_segments',
    '-hls_segment_filename', path.join(hlsDir, '%v/s%04d.ts'),
    '-master_pl_name', 'master.m3u8',
    '-var_stream_map', streamMap,
    path.join(hlsDir, '%v/index.m3u8'),
  );
  // Allow ~4x realtime worst case plus fixed overhead.
  await run('ffmpeg', args, { timeoutMs: 10 * 60_000 + (p.duration ?? 60) * 4000 });
}

const MIME_EXT: Record<string, string> = {
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
  'image/webp': 'webp', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'application/pdf': 'pdf', 'application/zip': 'zip',
};

/** Download a page URL (Instagram, YouTube, TikTok, X...) with yt-dlp, or a direct file with fetch. */
export async function downloadUrl(url: string, destDir: string): Promise<{ file: string; filename: string; mime?: string; title?: string; description?: string; uploader?: string }> {
  await fsp.mkdir(destDir, { recursive: true });
  const head = await fetch(url, { method: 'GET', redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 Timeline' }, signal: AbortSignal.timeout(30_000) }).catch(() => null);
  const type = head?.headers.get('content-type') ?? '';
  if (head?.ok && head.body && !type.includes('text/html')) {
    const cd = head.headers.get('content-disposition') ?? '';
    const fromHeader = /filename\*=UTF-8''([^;]+)/i.exec(cd)?.[1] ?? /filename="?([^";]+)"?/i.exec(cd)?.[1];
    let name = decodeURIComponent(fromHeader ?? (new URL(head.url).pathname.split('/').pop() || 'download')) || 'download';
    const ext = MIME_EXT[type.split(';')[0].trim()];
    if (!/\.[a-z0-9]{2,5}$/i.test(name) && ext) name += `.${ext}`;
    const file = path.join(destDir, `direct-${Date.now()}-${name.replace(/[^\w.\-]+/g, '_')}`);
    const fh = await fsp.open(file, 'w');
    const ws = fh.createWriteStream();
    const { Readable } = await import('node:stream');
    const { pipeline } = await import('node:stream/promises');
    await pipeline(Readable.fromWeb(head.body as any), ws);
    return { file, filename: name, mime: type.split(';')[0] || undefined };
  }
  try {
    await head?.body?.cancel();
  } catch {}

  const outTpl = path.join(destDir, 'ytdlp-%(id)s.%(ext)s');
  const args = [
    '--no-playlist', '--no-progress', '--restrict-filenames',
    '-f', 'bv*[vcodec^=avc1]+ba[ext=m4a]/bv*+ba/b',
    '--merge-output-format', 'mp4',
    '--write-info-json',
    '-o', outTpl,
    '--print', 'after_move:filepath',
  ];
  if (config.ytDlpCookies) args.push('--cookies', config.ytDlpCookies);
  args.push(url);
  const { stdout } = await run('yt-dlp', args, { timeoutMs: 30 * 60_000 });
  const file = stdout.trim().split('\n').pop()!;
  let meta: any = {};
  try {
    meta = JSON.parse(await fsp.readFile(file.replace(/\.[^.]+$/, '.info.json'), 'utf8'));
    await fsp.rm(file.replace(/\.[^.]+$/, '.info.json'), { force: true });
  } catch {}
  return {
    file,
    filename: `${(meta.title || meta.id || 'video').toString().slice(0, 80).replace(/[^\w.\- ]+/g, '_')}.${file.split('.').pop()}`,
    title: meta.title,
    description: meta.description,
    uploader: meta.uploader ?? meta.channel,
  };
}
