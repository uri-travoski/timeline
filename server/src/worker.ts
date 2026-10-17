// Standalone worker process (optional: by default the API server runs the worker in-process).
import { migrate } from './db.ts';
import { startWorker, stopWorker } from './jobs/worker.ts';

await migrate();
startWorker();
process.on('SIGTERM', () => {
  stopWorker();
  setTimeout(() => process.exit(0), 3000);
});
