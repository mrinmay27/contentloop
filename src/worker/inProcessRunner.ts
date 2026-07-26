import { query } from "../db/pool.js";
import { JOBS, JOB_NAMES, type JobName } from "./jobs.js";

/** Desktop scheduling is ELAPSED-TIME based, not wall-clock cron: an app the
 *  user opens at 10am must still ingest, whereas a `0 7 * * *` cron would
 *  simply never fire. Values mirror server-mode intent (daily pipeline,
 *  30m schedule, 10m post, hourly analyze). */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const JOB_CADENCE: Record<JobName, number> = {
  ingest: 20 * HOUR,
  score: 20 * HOUR,
  generate: 20 * HOUR,
  media: 20 * HOUR,
  render: 20 * HOUR,
  schedule: 30 * MINUTE,
  post: 10 * MINUTE,
  analyze: 1 * HOUR,
};

/** Run on launch (in this order) so an app opened at 19:30 publishes the
 *  17:00 job within seconds. media/render are excluded — they are CPU/network
 *  heavy and would stall a freshly-opened UI. */
export const CATCH_UP_JOBS: JobName[] = ["post", "schedule", "analyze", "ingest", "score", "generate"];

const TICK_MS = MINUTE;

/** Due when never run, or when at least `intervalMs` has elapsed. A
 *  last-run in the future (clock skew / timezone change) is treated as not
 *  due rather than firing every tick. */
export function isJobDue(lastRunAt: Date | null, intervalMs: number, now: Date = new Date()): boolean {
  if (!lastRunAt) return true;
  const elapsed = now.getTime() - lastRunAt.getTime();
  if (elapsed < 0) return false;
  return elapsed >= intervalMs;
}

async function readLastRuns(): Promise<Map<JobName, Date>> {
  const r = await query(`SELECT job, last_run_at FROM job_runs`);
  const map = new Map<JobName, Date>();
  for (const row of r.rows) map.set(row.job as JobName, new Date(row.last_run_at));
  return map;
}

async function recordRun(job: JobName, status: "ok" | "failed", error?: string): Promise<void> {
  await query(
    `INSERT INTO job_runs (job, last_run_at, last_status, last_error)
     VALUES ($1, now(), $2, $3)
     ON CONFLICT (job) DO UPDATE
       SET last_run_at = now(), last_status = EXCLUDED.last_status, last_error = EXCLUDED.last_error`,
    [job, status, error ?? null]
  );
}

/** In-flight guard: a long job (e.g. render) must not be re-entered by the
 *  next tick — AND must not race a manual POST /api/jobs/:name run. The
 *  original BullMQ `concurrency: 1` on post/analyze encoded exactly this
 *  (runLearningStep is not re-entrant); the set is module-level and the
 *  runner is imported once per process, so both callers share it. */
const running = new Set<JobName>();

/** Public, guarded entrypoint. `POST /api/jobs/:name` MUST use this in
 *  desktop mode rather than calling JOBS[name]() directly, or a double-click
 *  can run `analyze` concurrently with the runner's own tick. */
export async function runJobGuarded(job: JobName): Promise<void> {
  await runJob(job);
}

async function runJob(job: JobName): Promise<void> {
  if (running.has(job)) return;
  running.add(job);
  const started = Date.now();
  try {
    await JOBS[job]();
    await recordRun(job, "ok");
    console.log(`[runner] ${job} ok (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  } catch (err: any) {
    const message = err?.message ?? String(err);
    console.warn(`[runner] ${job} failed: ${message}`);
    // Record the failure so a persistently broken job still backs off to its
    // cadence instead of retrying every tick.
    await recordRun(job, "failed", message.slice(0, 500)).catch(() => {});
  } finally {
    running.delete(job);
  }
}

async function tick(): Promise<void> {
  let lastRuns: Map<JobName, Date>;
  try {
    lastRuns = await readLastRuns();
  } catch (err: any) {
    console.warn(`[runner] tick skipped — job_runs unreadable: ${err?.message ?? err}`);
    return;
  }
  const now = new Date();
  // Sequential: one process, and serialising avoids media/render competing
  // with the UI's own queries.
  for (const job of JOB_NAMES) {
    if (isJobDue(lastRuns.get(job) ?? null, JOB_CADENCE[job], now)) await runJob(job);
  }
}

/** Start the desktop scheduler: a catch-up pass, then a 60s tick loop.
 *  Returns a stop function (used by tests/shutdown). */
export async function startInProcessRunner(): Promise<() => void> {
  console.log(`[runner] catch-up pass: ${CATCH_UP_JOBS.join(" → ")}`);
  const lastRuns = await readLastRuns().catch(() => new Map<JobName, Date>());
  const now = new Date();
  for (const job of CATCH_UP_JOBS) {
    // post/schedule always run at launch (publishing a due job is the whole
    // point of catch-up); the rest respect their cadence.
    const always = job === "post" || job === "schedule";
    if (always || isJobDue(lastRuns.get(job) ?? null, JOB_CADENCE[job], now)) await runJob(job);
  }
  const handle = setInterval(() => { void tick(); }, TICK_MS);
  console.log(`[runner] scheduler started (tick ${TICK_MS / 1000}s)`);
  return () => clearInterval(handle);
}
