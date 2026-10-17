import fs from 'node:fs';
import type { Readable } from 'node:stream';
import { S3Client, GetObjectCommand, DeleteObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ByteRange, ReadResult, StorageDriver } from './types.ts';

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix?: string;
  forcePathStyle?: boolean;
}

/** Works with Backblaze B2, Cloudflare R2, AWS S3, MinIO, Wasabi... */
export class S3Driver implements StorageDriver {
  readonly type = 's3' as const;
  private client: S3Client;
  constructor(private cfg: S3Config) {
    this.client = new S3Client({
      endpoint: cfg.endpoint || undefined,
      region: cfg.region || 'auto',
      forcePathStyle: cfg.forcePathStyle,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      // B2 and R2 don't support the newer default checksum headers on every operation.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  async put({ key, filePath, mime, size }: { key: string; filePath: string; mime: string; size: number }) {
    const Key = (this.cfg.prefix ?? '') + key;
    await new Upload({
      client: this.client,
      params: { Bucket: this.cfg.bucket, Key, Body: fs.createReadStream(filePath), ContentType: mime, ContentLength: size },
      partSize: 16 * 1024 * 1024,
      queueSize: 4,
    }).done();
    return Key;
  }

  async read(key: string, size: number, range?: ByteRange): Promise<ReadResult> {
    const res = await this.client.send(
      new GetObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        Range: range ? `bytes=${range.start}-${range.end ?? ''}` : undefined,
      }),
    );
    return {
      stream: res.Body as Readable,
      status: range ? 206 : 200,
      contentLength: res.ContentLength ?? (range ? undefined : size),
      contentRange: res.ContentRange,
    };
  }

  async directUrl(key: string, filename: string, mime: string) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        ResponseContentType: mime,
        ResponseContentDisposition: `inline; filename*=UTF-8''${encodeURIComponent(filename)}`,
      }),
      { expiresIn: 6 * 3600 },
    );
  }

  async remove(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
  }

  async check() {
    await this.client.send(new HeadBucketCommand({ Bucket: this.cfg.bucket }));
  }
}
