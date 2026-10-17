import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { ByteRange, ReadResult, StorageDriver } from './types.ts';

export class LocalDriver implements StorageDriver {
  readonly type = 'local' as const;
  constructor(private root: string) {}

  private abs(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(path.resolve(this.root) + path.sep)) throw new Error('Invalid storage key');
    return p;
  }

  async put({ key, filePath }: { key: string; filePath: string }) {
    const dest = this.abs(key);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    // Copy (not move): the spool file is still needed by the media worker and is cleaned up later.
    await fsp.copyFile(filePath, dest);
    return key;
  }

  async read(key: string, size: number, range?: ByteRange): Promise<ReadResult> {
    const p = this.abs(key);
    if (range) {
      const end = Math.min(range.end ?? size - 1, size - 1);
      return {
        stream: fs.createReadStream(p, { start: range.start, end }),
        status: 206,
        contentLength: end - range.start + 1,
        contentRange: `bytes ${range.start}-${end}/${size}`,
      };
    }
    return { stream: fs.createReadStream(p), status: 200, contentLength: size };
  }

  async remove(key: string) {
    await fsp.rm(this.abs(key), { force: true });
  }

  async check() {
    await fsp.mkdir(this.root, { recursive: true });
    await fsp.access(this.root, fs.constants.W_OK);
  }
}
