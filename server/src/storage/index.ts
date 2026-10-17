import { sql } from '../db.ts';
import { config } from '../config.ts';
import { decrypt, encrypt } from '../lib/crypto.ts';
import { LocalDriver } from './local.ts';
import { S3Driver, type S3Config } from './s3.ts';
import { GDriveDriver, type GDriveConfig } from './gdrive.ts';
import type { StorageDriver } from './types.ts';

export type { StorageDriver } from './types.ts';

export interface BackendRow {
  id: string;
  owner_id: string | null;
  type: 'local' | 's3' | 'gdrive';
  name: string;
  config: string;
  from_env: boolean;
}

const drivers = new Map<string, StorageDriver>();

export function makeDriver(type: BackendRow['type'], cfg: any): StorageDriver {
  switch (type) {
    case 'local':
      return new LocalDriver(cfg.root ?? config.localStorageDir);
    case 's3':
      return new S3Driver(cfg as S3Config);
    case 'gdrive':
      return new GDriveDriver(cfg as GDriveConfig);
  }
}

export async function driverFor(backendId: string): Promise<StorageDriver> {
  let d = drivers.get(backendId);
  if (d) return d;
  const [row] = await sql<BackendRow[]>`SELECT * FROM storage_backends WHERE id = ${backendId}`;
  if (!row) throw new Error(`Storage backend ${backendId} no longer exists`);
  d = makeDriver(row.type, decrypt(row.config));
  drivers.set(backendId, d);
  return d;
}

export function forgetDriver(backendId: string) {
  drivers.delete(backendId);
}

export async function createBackend(ownerId: string | null, type: BackendRow['type'], name: string, cfg: unknown, fromEnv = false) {
  const [row] = await sql<BackendRow[]>`
    INSERT INTO storage_backends (owner_id, type, name, config, from_env)
    VALUES (${ownerId}, ${type}, ${name}, ${encrypt(cfg)}, ${fromEnv}) RETURNING *`;
  return row;
}

/** Make sure the built-in local backend and the S3 backend from env exist. */
export async function ensureEnvBackends() {
  const [local] = await sql`SELECT id FROM storage_backends WHERE from_env AND type = 'local'`;
  if (!local) await createBackend(null, 'local', 'Server disk', {}, true);

  const [s3row] = await sql<BackendRow[]>`SELECT * FROM storage_backends WHERE from_env AND type = 's3'`;
  if (config.s3) {
    if (s3row) {
      await sql`UPDATE storage_backends SET name = ${config.s3.name}, config = ${encrypt(config.s3)} WHERE id = ${s3row.id}`;
      forgetDriver(s3row.id);
    } else {
      await createBackend(null, 's3', config.s3.name, config.s3, true);
    }
  }
}

/** Backends a user may store files in: their own (e.g. their Google Drive) + server-wide ones. */
export async function backendsFor(ownerId: string) {
  return sql<BackendRow[]>`
    SELECT * FROM storage_backends WHERE owner_id = ${ownerId} OR owner_id IS NULL
    ORDER BY owner_id NULLS LAST, created_at`;
}

/**
 * Pick where a new upload goes. Order: explicit choice -> user's default setting ->
 * user's Google Drive -> server S3 (B2/R2) -> server disk.
 */
export async function pickBackend(ownerId: string, requested?: string | null): Promise<BackendRow> {
  const list = await backendsFor(ownerId);
  const byId = (id?: string | null) => (id ? list.find((b) => b.id === id) : undefined);
  const [u] = await sql`SELECT settings FROM users WHERE id = ${ownerId}`;
  const chosen =
    byId(requested) ??
    byId(u?.settings?.defaultBackendId) ??
    list.find((b) => b.type === 'gdrive' && b.owner_id === ownerId) ??
    list.find((b) => b.type === 's3') ??
    list.find((b) => b.type === 'local');
  if (!chosen) throw new Error('No storage backend configured');
  return chosen;
}

export function publicBackend(b: BackendRow) {
  let detail = '';
  try {
    const cfg = decrypt(b.config);
    if (b.type === 'gdrive') detail = cfg.account ?? '';
    if (b.type === 's3') detail = `${cfg.bucket}${cfg.endpoint ? ' @ ' + new URL(cfg.endpoint).host : ''}`;
    if (b.type === 'local') detail = 'Stored on the server';
  } catch {}
  return { id: b.id, type: b.type, name: b.name, shared: b.owner_id === null, fromEnv: b.from_env, detail };
}
