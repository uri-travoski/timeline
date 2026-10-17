import fs from 'node:fs';
import type { Readable } from 'node:stream';
import { google, type drive_v3 } from 'googleapis';
import { config } from '../config.ts';
import type { ByteRange, ReadResult, StorageDriver } from './types.ts';

export interface GDriveConfig {
  refreshToken: string;
  folderId: string;
  account?: string;
}

export const DRIVE_SCOPES = [
  // drive.file = only files this app created. No access to the rest of the user's Drive,
  // and no Google security review needed for the OAuth app.
  'https://www.googleapis.com/auth/drive.file',
  'openid',
  'email',
];

export function oauthClient(redirectUri?: string) {
  return new google.auth.OAuth2(config.google.clientId, config.google.clientSecret, redirectUri);
}

export class GDriveDriver implements StorageDriver {
  readonly type = 'gdrive' as const;
  private drive: drive_v3.Drive;
  constructor(private cfg: GDriveConfig) {
    const auth = oauthClient();
    auth.setCredentials({ refresh_token: cfg.refreshToken });
    this.drive = google.drive({ version: 'v3', auth });
  }

  async put({ key, filePath, mime, filename }: { key: string; filePath: string; mime: string; filename: string }) {
    const res = await this.drive.files.create({
      requestBody: {
        name: `${key.split('/').slice(1, 4).join('-')}_${filename}`.replace(/^[-_]+/, ''),
        parents: [this.cfg.folderId],
        appProperties: { timelineKey: key },
      },
      media: { mimeType: mime, body: fs.createReadStream(filePath) },
      fields: 'id',
    });
    if (!res.data.id) throw new Error('Google Drive did not return a file id');
    return res.data.id;
  }

  async read(fileId: string, size: number, range?: ByteRange): Promise<ReadResult> {
    const headers: Record<string, string> = {};
    if (range) headers.Range = `bytes=${range.start}-${range.end ?? ''}`;
    const res = await this.drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream', headers });
    const len = res.headers['content-length'];
    return {
      stream: res.data as unknown as Readable,
      status: res.status === 206 ? 206 : 200,
      contentLength: len ? Number(len) : range ? undefined : size,
      contentRange: res.headers['content-range'] as string | undefined,
    };
  }

  async remove(fileId: string) {
    try {
      await this.drive.files.delete({ fileId });
    } catch (e: any) {
      if (e?.code !== 404) throw e;
    }
  }

  async check() {
    await this.drive.files.get({ fileId: this.cfg.folderId, fields: 'id,trashed' });
  }

  /** Create the app folder in the user's Drive (used once, right after OAuth). */
  static async createFolder(refreshToken: string, name: string): Promise<{ folderId: string; account: string }> {
    const auth = oauthClient();
    auth.setCredentials({ refresh_token: refreshToken });
    const drive = google.drive({ version: 'v3', auth });
    const about = await drive.about.get({ fields: 'user(emailAddress)' });
    const res = await drive.files.create({
      requestBody: { name, mimeType: 'application/vnd.google-apps.folder', description: 'Attachments from your Timeline app' },
      fields: 'id',
    });
    return { folderId: res.data.id!, account: about.data.user?.emailAddress ?? '' };
  }
}
