import path from 'node:path';

const env = process.env;

function required(name: string, fallback?: string): string {
  const v = env[name] ?? fallback;
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

const dataDir = path.resolve(env.DATA_DIR ?? './data');

export const config = {
  port: Number(env.PORT ?? 8080),
  publicUrl: (env.PUBLIC_URL ?? 'http://localhost:8080').replace(/\/$/, ''),
  databaseUrl: required('DATABASE_URL', 'postgres://timeline:timeline@localhost:5432/timeline'),
  // Used for session/API-key hashing, signed media URLs and encrypting storage credentials.
  appSecret: required('APP_SECRET', env.NODE_ENV === 'production' ? undefined : 'dev-secret-change-me-dev-secret-change-me'),
  admin: {
    email: env.ADMIN_EMAIL ?? '',
    password: env.ADMIN_PASSWORD ?? '',
    name: env.ADMIN_NAME ?? 'Admin',
    resetPassword: env.ADMIN_RESET_PASSWORD === 'true',
  },
  dataDir,
  spoolDir: path.join(dataDir, 'spool'),
  // Derivatives (thumbnails, posters, HLS renditions) live here so reels stay fast
  // no matter where the original is stored (Google Drive is too slow to stream from).
  mediaDir: path.join(dataDir, 'media'),
  localStorageDir: path.join(dataDir, 'files'),
  webDir: path.resolve(env.WEB_DIR ?? '../web/dist'),
  trashRetentionDays: Number(env.TRASH_RETENTION_DAYS ?? 30),
  maxUploadBytes: Number(env.MAX_UPLOAD_MB ?? 4096) * 1024 * 1024,
  google: {
    clientId: env.GOOGLE_CLIENT_ID ?? '',
    clientSecret: env.GOOGLE_CLIENT_SECRET ?? '',
    folderName: env.GOOGLE_DRIVE_FOLDER ?? 'Timeline',
  },
  // Optional server-wide S3-compatible backend (Backblaze B2, Cloudflare R2, AWS S3, MinIO...).
  s3: env.S3_BUCKET
    ? {
        name: env.S3_NAME ?? 'S3 storage',
        endpoint: env.S3_ENDPOINT ?? '',
        region: env.S3_REGION ?? 'auto',
        bucket: env.S3_BUCKET,
        accessKeyId: required('S3_ACCESS_KEY_ID'),
        secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
        prefix: env.S3_PREFIX ?? 'timeline/',
        forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
      }
    : null,
  firebaseServiceAccount: env.FIREBASE_SERVICE_ACCOUNT_JSON ?? '',
  firebaseServiceAccountFile: env.FIREBASE_SERVICE_ACCOUNT_FILE ?? '',
  vapid: {
    publicKey: env.VAPID_PUBLIC_KEY ?? '',
    privateKey: env.VAPID_PRIVATE_KEY ?? '',
    subject: env.VAPID_SUBJECT ?? 'mailto:admin@localhost',
  },
  hls: {
    // Rendition heights for reels. Only heights <= the source height are produced.
    heights: (env.HLS_HEIGHTS ?? '360,540,720,1080').split(',').map(Number).filter(Boolean),
    preset: env.HLS_PRESET ?? 'veryfast',
  },
  ytDlpCookies: env.YTDLP_COOKIES_FILE ?? '',
  workerInProcess: env.WORKER_IN_PROCESS !== 'false',
  secureCookies: (env.PUBLIC_URL ?? '').startsWith('https://'),
};
