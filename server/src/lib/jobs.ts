import { sql } from '../db.ts';

export type JobType = 'process_attachment' | 'import_url' | 'delete_object' | 'push';

export const MEDIA_JOBS: JobType[] = ['process_attachment', 'import_url'];

export async function enqueue(type: JobType, payload: Record<string, unknown>, opts: { delaySec?: number; maxAttempts?: number } = {}) {
  await sql`INSERT INTO jobs (type, payload, run_at, max_attempts)
            VALUES (${type}, ${sql.json(payload as any)}, now() + ${`${opts.delaySec ?? 0} seconds`}::interval, ${opts.maxAttempts ?? 6})`;
}

export interface Job {
  id: string;
  type: JobType;
  payload: any;
  attempts: number;
  max_attempts: number;
}

export async function claim(types: JobType[]): Promise<Job | null> {
  const [job] = await sql<Job[]>`
    UPDATE jobs SET status = 'running', locked_at = now(), attempts = attempts + 1
    WHERE id = (
      SELECT id FROM jobs WHERE status = 'queued' AND run_at <= now() AND type = ANY(${types})
      ORDER BY run_at FOR UPDATE SKIP LOCKED LIMIT 1
    ) RETURNING id, type, payload, attempts, max_attempts`;
  return job ?? null;
}

export async function complete(job: Job) {
  await sql`UPDATE jobs SET status = 'done', locked_at = NULL WHERE id = ${job.id}`;
}

export async function fail(job: Job, err: unknown) {
  const msg = String((err as any)?.stack ?? err).slice(0, 4000);
  if (job.attempts >= job.max_attempts) {
    await sql`UPDATE jobs SET status = 'failed', locked_at = NULL, last_error = ${msg} WHERE id = ${job.id}`;
    return false;
  }
  const backoff = Math.min(3600, 15 * 2 ** job.attempts);
  await sql`UPDATE jobs SET status = 'queued', locked_at = NULL, last_error = ${msg},
            run_at = now() + ${`${backoff} seconds`}::interval WHERE id = ${job.id}`;
  return true;
}

/** Jobs left "running" by a crashed worker go back to the queue. */
export async function recoverStale() {
  await sql`UPDATE jobs SET status = 'queued', locked_at = NULL WHERE status = 'running' AND locked_at < now() - interval '2 hours'`;
}
