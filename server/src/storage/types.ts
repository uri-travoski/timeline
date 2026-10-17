import type { Readable } from 'node:stream';

export interface ByteRange {
  start: number;
  end?: number; // inclusive
}

export interface ReadResult {
  stream: Readable;
  status: 200 | 206;
  contentLength?: number;
  contentRange?: string;
}

export interface StorageDriver {
  readonly type: 'local' | 's3' | 'gdrive';
  /** Upload a local file; returns the storage key to keep in the DB. */
  put(opts: { key: string; filePath: string; mime: string; filename: string; size: number }): Promise<string>;
  /** Stream an object (with optional byte range). */
  read(storageKey: string, size: number, range?: ByteRange): Promise<ReadResult>;
  /** Optional: a direct, time-limited URL the client can be redirected to. */
  directUrl?(storageKey: string, filename: string, mime: string): Promise<string>;
  remove(storageKey: string): Promise<void>;
  /** Cheap credential/connectivity check used by the settings UI. */
  check(): Promise<void>;
}
