/** Server-mode worker entrypoint: wires each job function into a BullMQ
 *  Worker. Job bodies live in jobs.ts (shared with the desktop in-process
 *  runner); this file is only queue plumbing. */
import { Worker } from "bullmq";
import { env } from "../config/env.js";
import { JOBS, JOB_CONCURRENCY, JOB_NAMES } from "./jobs.js";
import { connection, enqueueDailyPipeline } from "./queues.js";

for (const name of JOB_NAMES) {
  new Worker(name, async () => { await JOBS[name](); }, {
    connection,
    concurrency: JOB_CONCURRENCY[name],
  });
}

await enqueueDailyPipeline();
console.log(`Worker running in ${env.NODE_ENV} mode — queues: ${JOB_NAMES.join(", ")}`);
