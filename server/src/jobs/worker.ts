import { execFile } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { sql } from '../db.ts';
import { config } from '../config.ts';
import { claim, complete, fail, recoverStale, MEDIA_JOBS, type Job, type JobType } from '../lib/jobs.ts';
import { runDeleteObject, runImportUrl, runProcessAttachment } from '../services/attachments.ts';
import { autoPurge, fireDueReminders } from '../services/misc.ts';

const handlers: Record<JobType, (p: any) => Promise<unknown>> = {
  process_attachment: (p) => runProcessAttachment(p.attachmentId),
  import_url: async (p) => {
    try {
      return await runImportUrl(p);
    } catch (e) {
      if (p.postId) {
        await sql`UPDATE posts SET source_meta = source_meta || ${sql.json({ importError: String((e as Error).message).slice(0, 300) })} WHERE id = ${p.postId}`;
      }
      throw e;
    }
  },
  delete_object: (p) => runDeleteObject(p.attachmentId),
  push: async () => {},
};

let stopping = false;

async function lane(name: string, types: JobType[]) {
  while (!stopping) {
    let job: Job | null = null;
    try {
      job = await claim(types);
      if (!job) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      await handlers[job.type](job.payload);
      await complete(job);
    } catch (e) {
      if (job) {
        const retry = await fail(job, e);
        console.error(`[worker:${name}] job ${job.id} (${job.type}) failed${retry ? ', will retry' : ''}:`, (e as Error).message);
      } else {
        console.error(`[worker:${name}]`, (e as Error).message);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }
}

function every(ms: number, name: string, fn: () => Promise<unknown>) {
  const tick = async () => {
    try {
      await fn();
    } catch (e) {
      console.error(`[worker:${name}]`, (e as Error).message);
    }
    if (!stopping) setTimeout(tick, ms);
  };
  setTimeout(tick, 2000);
}

async function cleanupSpool() {
  // Spool files no attachment refers to (e.g. aborted uploads) older than a day.
  const files = await fsp.readdir(config.spoolDir).catch(() => [] as string[]);
  const used = new Set((await sql`SELECT spool_path FROM attachments WHERE spool_path IS NOT NULL`).map((r) => path.basename(r.spool_path)));
  for (const f of files) {
    if (used.has(f)) continue;
    const p = path.join(config.spoolDir, f);
    const st = await fsp.stat(p).catch(() => null);
    if (st && Date.now() - st.mtimeMs > 86400_000) await fsp.rm(p, { force: true, recursive: true });
  }
}

export function startWorker() {
  const mediaLanes = Number(process.env.MEDIA_CONCURRENCY ?? 1);
  for (let i = 0; i < mediaLanes; i++) lane(`media${i}`, MEDIA_JOBS);
  lane('default', ['delete_object', 'push']);
  every(10_000, 'reminders', fireDueReminders);
  every(3600_000, 'maintenance', async () => {
    await recoverStale();
    await autoPurge(config.trashRetentionDays);
    await sql`DELETE FROM jobs WHERE status = 'done' AND created_at < now() - interval '7 days'`;
    await sql`DELETE FROM sessions WHERE expires_at < now()`;
    await cleanupSpool();
  });
  // Sites like Instagram change often; keep the downloader current (no-op if it can't self-update).
  every(86400_000, 'yt-dlp', () =>
    new Promise<void>((resolve) => execFile('yt-dlp', ['-U'], { timeout: 120_000 }, (err, out) => (console.log('[worker] yt-dlp', (err?.message ?? out).trim().split('\n').pop()), resolve()))),
  );
  console.log(`[worker] started (${mediaLanes} media lane${mediaLanes > 1 ? 's' : ''})`);
}

export function stopWorker() {
  stopping = true;
}
