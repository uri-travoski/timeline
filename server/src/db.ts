import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { config } from './config.ts';

export const sql = postgres(config.databaseUrl, {
  max: Number(process.env.DB_POOL ?? 10),
  onnotice: () => {},
  transform: { undefined: null },
});

export type Sql = typeof sql;

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

export async function migrate() {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
  // Serialise migrations when several containers start at once.
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(727274)`;
    const done = new Set((await tx`SELECT name FROM schema_migrations`).map((r) => r.name as string));
    const files = (await fs.readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const text = await fs.readFile(path.join(migrationsDir, file), 'utf8');
      await tx.unsafe(text);
      await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
      console.log(`[db] applied migration ${file}`);
    }
  });
}
