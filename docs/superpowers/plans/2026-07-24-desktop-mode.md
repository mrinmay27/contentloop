# Sprint D2 Phase 1 — Desktop Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** TPCE runs as a single Docker-free, Redis-free process with embedded Postgres (`npm run desktop`) — the prerequisite for native installers — without changing server-mode behavior.

**Architecture:** BullMQ job bodies are extracted verbatim into plain async functions (`src/worker/jobs.ts`); server mode wires them into BullMQ exactly as today, desktop mode drives them from an in-process runner using persisted last-run timestamps (`job_runs`, migration 008) instead of cron. `src/desktop/main.ts` boots embedded Postgres → migrations → Express (serving `dist-web`) → runner in one process. Spec: `docs/superpowers/specs/2026-07-24-desktop-mode-design.md`.

**Tech Stack:** TypeScript ESM (`.js` import suffixes, top-level await is available — `src/worker/index.ts` already uses it), Express 5, pg, BullMQ (server mode only), `embedded-postgres` (optionalDependency), vitest (130 green — keep green).

**Conventions:** gates = `npx vitest run` + `npx tsc -p tsconfig.json --noEmit` + `npm run build`. NOTE: `dist-web` is no longer tracked by git (Sprint U1 publish audit) — do NOT run `git checkout -- dist-web`. Dev DB: `docker compose exec -T postgres psql -U theme -d theme_engine`. READ every file before modifying. Commit per task.

**CAUTION — the user's `npm run dev` may be running** against the dev Postgres/Redis on :4000/:5173. Never kill their processes. Desktop-mode testing MUST use a temp data dir and its own port.

---

### Task 1: Extract job bodies (pure move) + rewire server mode

**Files:**
- Create: `src/worker/jobs.ts`
- Modify: `src/worker/index.ts` (becomes a thin BullMQ wiring file)
- Test: `tests/jobs.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/jobs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { JOB_NAMES, JOBS } from "../src/worker/jobs.js";

describe("job registry", () => {
  it("exports exactly the eight pipeline jobs", () => {
    expect([...JOB_NAMES].sort()).toEqual(
      ["analyze", "generate", "ingest", "media", "post", "render", "schedule", "score"]
    );
  });

  it("every name maps to a callable function", () => {
    for (const name of JOB_NAMES) expect(typeof JOBS[name]).toBe("function");
  });

  it("JOBS has no extra keys beyond JOB_NAMES", () => {
    expect(Object.keys(JOBS).sort()).toEqual([...JOB_NAMES].sort());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/jobs.test.ts`
Expected: FAIL — cannot resolve `../src/worker/jobs.js`.

- [ ] **Step 3: Create `src/worker/jobs.ts` by MOVING the bodies**

READ `src/worker/index.ts` completely first. Create `src/worker/jobs.ts` containing:

1. The **entire import block** from `src/worker/index.ts` EXCEPT `import { Worker } from "bullmq"` and `import { connection, enqueueDailyPipeline } from "./queues.js"` (jobs must not touch BullMQ/Redis).
2. The **tuning-overrides try/catch block** verbatim (the `configStore.get("AUTOMATION_THRESHOLDS")` block) — it must run before any job executes, and both runners import this module.
3. Each `new Worker("<name>", async () => { BODY }, opts)` becomes:

```ts
export async function ingest(): Promise<void> { /* BODY verbatim */ }
export async function score(): Promise<void> { /* BODY verbatim */ }
export async function generate(): Promise<void> { /* BODY verbatim */ }
export async function media(): Promise<void> { /* BODY verbatim */ }
export async function render(): Promise<void> { /* BODY verbatim */ }
export async function schedule(): Promise<void> { /* BODY verbatim */ }
export async function post(): Promise<void> { /* BODY verbatim */ }
export async function analyze(): Promise<void> { /* BODY verbatim */ }
```

**The bodies must be copied UNCHANGED** — same dynamic imports, same try/catch blocks, same console.log strings. This task is a pure move; a reviewer will diff it.

4. Append the registry + the concurrency map (used by both runners so the values live in one place):

```ts
export const JOBS = { ingest, score, generate, media, render, schedule, post, analyze } as const;
export type JobName = keyof typeof JOBS;
export const JOB_NAMES = Object.keys(JOBS) as JobName[];

/** BullMQ concurrency per job (server mode). Values preserved from the
 *  original worker: media/render are resource-heavy, post/analyze must not
 *  overlap themselves (atomic claim + non-reentrant learn step). */
export const JOB_CONCURRENCY: Record<JobName, number> = {
  ingest: 3, score: 3, generate: 3, media: 1, render: 1, schedule: 3, post: 1, analyze: 1,
};
```

- [ ] **Step 4: Rewire `src/worker/index.ts` as thin BullMQ wiring**

Replace the ENTIRE contents of `src/worker/index.ts` with:

```ts
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
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run` → 133 passed (130 + 3 new).
Run: `npx tsc -p tsconfig.json --noEmit` → clean.

- [ ] **Step 6: Verify server mode still works (regression proof)**

With docker Postgres+Redis up, start the worker on its own and confirm it boots and processes a manual job. Use the user's already-running API if present, else start one:

```bash
npx tsx src/worker/index.ts > /tmp/d2-worker.log 2>&1 &
sleep 6
curl -s -X POST http://localhost:4000/api/jobs/schedule
sleep 6
grep -E "Worker running|schedule|error" /tmp/d2-worker.log | tail -5
pkill -f "tsx src/worker/index.ts"
```
Expected: `Worker running in development mode — queues: ingest, score, ...` and no crash. Report the log lines.

- [ ] **Step 7: Commit**

```bash
git add src/worker/jobs.ts src/worker/index.ts tests/jobs.test.ts
git commit -m "refactor(worker): extract job bodies into jobs.ts; index.ts becomes BullMQ wiring"
```

---

### Task 2: Mode gating in the API server

**Files:**
- Create: `src/config/mode.ts`
- Modify: `src/api/server.ts` (top-level bull-board imports, `/queues` mount, `POST /api/jobs/:name`)
- Test: `tests/mode.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/mode.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { resolveMode } from "../src/config/mode.js";

afterEach(() => { delete process.env.TPCE_MODE; });

describe("resolveMode", () => {
  it("defaults to server when unset", () => {
    delete process.env.TPCE_MODE;
    expect(resolveMode()).toBe("server");
  });
  it("returns desktop when TPCE_MODE=desktop", () => {
    process.env.TPCE_MODE = "desktop";
    expect(resolveMode()).toBe("desktop");
  });
  it("is case-insensitive and trims", () => {
    process.env.TPCE_MODE = " Desktop ";
    expect(resolveMode()).toBe("desktop");
  });
  it("falls back to server for unknown values", () => {
    process.env.TPCE_MODE = "banana";
    expect(resolveMode()).toBe("server");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mode.test.ts`
Expected: FAIL — cannot resolve `../src/config/mode.js`.

- [ ] **Step 3: Implement `src/config/mode.ts`**

```ts
/** Runtime mode. `server` (default) = BullMQ + Redis + external Postgres,
 *  separate api/worker processes. `desktop` = one process, in-process
 *  scheduler, embedded Postgres, no Redis. */
export type TpceMode = "server" | "desktop";

export function resolveMode(): TpceMode {
  return process.env.TPCE_MODE?.trim().toLowerCase() === "desktop" ? "desktop" : "server";
}

export const isDesktop = (): boolean => resolveMode() === "desktop";
```

Run: `npx vitest run tests/mode.test.ts` → 4 passed.

- [ ] **Step 4: Gate the bull-board mount in `src/api/server.ts`**

READ lines 1–115 of `src/api/server.ts` first. Make these edits:

1. DELETE the three top-level bull-board imports (currently lines 1–3):
```ts
import { ExpressAdapter } from "@bull-board/express";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
```
2. DELETE the top-level `import { queues } from "../worker/queues.js";` (currently line 32) — importing it opens an ioredis connection immediately, which must never happen in desktop mode.
3. Add near the other config imports:
```ts
import { isDesktop } from "../config/mode.js";
```
4. REPLACE the bull-board block (currently the `const boardServer = new ExpressAdapter(); … app.use("/queues", boardServer.getRouter());` lines) with a mode-gated dynamic import (this file is ESM and top-level await is available):

```ts
// Bull Board is server-mode only: desktop has no Redis/queues. Mounted here
// (before the SPA fallback) but the fallback's negative lookahead already
// excludes /queues, so ordering is not load-bearing.
if (!isDesktop()) {
  const [{ ExpressAdapter }, { createBullBoard }, { BullMQAdapter }, { queues }] = await Promise.all([
    import("@bull-board/express"),
    import("@bull-board/api"),
    import("@bull-board/api/bullMQAdapter"),
    import("../worker/queues.js"),
  ]);
  const boardServer = new ExpressAdapter();
  boardServer.setBasePath("/queues");
  createBullBoard({
    queues: Object.values(queues).map((queue) => new BullMQAdapter(queue)),
    serverAdapter: boardServer,
  });
  app.use("/queues", boardServer.getRouter());
}
```

- [ ] **Step 5: Make `POST /api/jobs/:name` mode-aware**

READ the existing route (search for `app.post("/api/jobs/:name"`). Replace its body with:

```ts
app.post("/api/jobs/:name", async (req, res, next) => {
  try {
    const params = z.object({ name: z.enum(["ingest", "score", "generate", "media", "render", "schedule", "post", "analyze"]) }).parse(req.params);
    if (isDesktop()) {
      // No queue in desktop mode — run the job in-process, fire-and-forget so
      // the request returns immediately (same contract as enqueueing).
      const { JOBS } = await import("../worker/jobs.js");
      JOBS[params.name]().catch((err: any) =>
        console.warn(`[jobs] ${params.name} failed: ${err?.message ?? err}`)
      );
    } else {
      const { queues } = await import("../worker/queues.js");
      await queues[params.name].add(`manual-${params.name}`, {}, { removeOnComplete: 25, removeOnFail: 25 });
    }
    res.json({ ok: true, queued: params.name });
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 6: Gates + server-mode regression check**

Run: `npx vitest run` → 137 passed (133 + 4). `npx tsc -p tsconfig.json --noEmit` → clean.

Server-mode proof (docker up; use a spare port so the user's :4000 is untouched):
```bash
PORT=4711 npx tsx src/api/server.ts > /tmp/d2-api.log 2>&1 &
sleep 6
curl -s -o /dev/null -w "queues: %{http_code}\n" http://localhost:4711/queues
curl -s -o /dev/null -w "health: %{http_code}\n" http://localhost:4711/api/health
pkill -f "tsx src/api/server.ts"
```
Expected: `queues: 200` (bull-board still mounted in server mode), `health: 200`.

- [ ] **Step 7: Commit**

```bash
git add src/config/mode.ts src/api/server.ts tests/mode.test.ts
git commit -m "feat(mode): TPCE_MODE gating — bull-board and queue enqueue are server-mode only"
```

---

### Task 3: `job_runs` + due-check + in-process runner

**Files:**
- Create: `src/db/migrations/008_job_runs.sql`
- Create: `src/worker/inProcessRunner.ts`
- Test: `tests/inProcessRunner.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/inProcessRunner.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isJobDue, JOB_CADENCE, CATCH_UP_JOBS } from "../src/worker/inProcessRunner.js";
import { JOB_NAMES } from "../src/worker/jobs.js";

const at = (iso: string) => new Date(iso);

describe("isJobDue", () => {
  const now = at("2026-07-24T12:00:00Z");

  it("is due when never run before", () => {
    expect(isJobDue(null, 60 * 60_000, now)).toBe(true);
  });
  it("is due exactly at the interval boundary", () => {
    expect(isJobDue(at("2026-07-24T11:00:00Z"), 60 * 60_000, now)).toBe(true);
  });
  it("is not due before the interval elapses", () => {
    expect(isJobDue(at("2026-07-24T11:30:00Z"), 60 * 60_000, now)).toBe(false);
  });
  it("is due long after the interval", () => {
    expect(isJobDue(at("2026-07-20T11:00:00Z"), 60 * 60_000, now)).toBe(true);
  });
  it("treats a future last-run (clock skew) as not due", () => {
    expect(isJobDue(at("2026-07-24T13:00:00Z"), 60 * 60_000, now)).toBe(false);
  });
});

describe("cadence table", () => {
  it("covers every job exactly once", () => {
    expect(Object.keys(JOB_CADENCE).sort()).toEqual([...JOB_NAMES].sort());
  });
  it("uses positive intervals", () => {
    for (const ms of Object.values(JOB_CADENCE)) expect(ms).toBeGreaterThan(0);
  });
  it("catch-up starts with post (publishing a due job is the priority)", () => {
    expect(CATCH_UP_JOBS[0]).toBe("post");
  });
  it("catch-up only contains known jobs and excludes heavy media/render", () => {
    for (const name of CATCH_UP_JOBS) expect(JOB_NAMES).toContain(name);
    expect(CATCH_UP_JOBS).not.toContain("media");
    expect(CATCH_UP_JOBS).not.toContain("render");
  });
});

describe("runJobGuarded", () => {
  it("is exported so the API route can share the runner's in-flight guard", async () => {
    const mod = await import("../src/worker/inProcessRunner.js");
    expect(typeof mod.runJobGuarded).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/inProcessRunner.test.ts`
Expected: FAIL — cannot resolve `../src/worker/inProcessRunner.js`.

- [ ] **Step 3: Migration**

Create `src/db/migrations/008_job_runs.sql`:

```sql
-- Sprint D2: desktop mode schedules by elapsed time (not wall-clock cron),
-- so it needs each job's last-run timestamp to survive app restarts.
CREATE TABLE IF NOT EXISTS job_runs (
  job         TEXT PRIMARY KEY,
  last_run_at TIMESTAMPTZ NOT NULL,
  last_status TEXT NOT NULL CHECK (last_status IN ('ok','failed')),
  last_error  TEXT
);
```

Apply: `npm run db:init` (applies 008; run again → "up to date").

- [ ] **Step 4: Implement the runner**

Create `src/worker/inProcessRunner.ts`:

```ts
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
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run` → 148 passed (138 + 10; baseline is 138 after the W1 parity test).
Run: `npx tsc -p tsconfig.json --noEmit` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/db/migrations/008_job_runs.sql src/worker/inProcessRunner.ts tests/inProcessRunner.test.ts
git commit -m "feat(desktop): job_runs table + elapsed-time in-process scheduler with launch catch-up"
```

---

### Task 4: Embedded Postgres + desktop entrypoint

**Files:**
- Create: `src/db/embedded.ts`
- Create: `src/desktop/main.ts`
- Modify: `package.json` (optionalDependency + `desktop` script)
- Test: `tests/dataDir.test.ts`

- [ ] **Step 1: Install the dependency**

```bash
npm install --save-optional embedded-postgres
```
This downloads platform binaries (~100MB) — expect it to take a minute. Verify it landed in `optionalDependencies` (NOT `dependencies`) in `package.json`; move it if npm put it in the wrong section.

- [ ] **Step 2: Write the failing test**

Create `tests/dataDir.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import { resolveDataDir } from "../src/db/embedded.js";

afterEach(() => { delete process.env.TPCE_DATA_DIR; });

describe("resolveDataDir", () => {
  it("honours TPCE_DATA_DIR and returns an absolute path", () => {
    process.env.TPCE_DATA_DIR = "./tmp-data";
    expect(path.isAbsolute(resolveDataDir())).toBe(true);
    expect(resolveDataDir().endsWith("tmp-data")).toBe(true);
  });

  it("falls back to a per-OS app dir containing TPCE", () => {
    delete process.env.TPCE_DATA_DIR;
    const dir = resolveDataDir();
    expect(path.isAbsolute(dir)).toBe(true);
    expect(dir.toLowerCase()).toContain("tpce");
  });
});
```

Run: `npx vitest run tests/dataDir.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `src/db/embedded.ts`**

```ts
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

/** Where desktop mode keeps its Postgres cluster and generated media.
 *  Override with TPCE_DATA_DIR (used by tests and by the Phase 2 shell). */
export function resolveDataDir(): string {
  const override = process.env.TPCE_DATA_DIR;
  if (override && override.trim()) return path.resolve(override.trim());
  const home = os.homedir();
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "TPCE");
  if (process.platform === "win32") return path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), "TPCE");
  return path.join(process.env.XDG_DATA_HOME ?? path.join(home, ".local", "share"), "tpce");
}

/** Ask the OS for a free port by binding :0 and releasing it. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error("no free port"))));
    });
  });
}

export interface EmbeddedPg {
  databaseUrl: string;
  stop: () => Promise<void>;
}

/** Boot a Postgres cluster inside the app's data dir. First run initialises
 *  it; later runs just start. Returns the DATABASE_URL to export BEFORE any
 *  module that reads it is imported. */
export async function startEmbeddedPostgres(): Promise<EmbeddedPg> {
  let EmbeddedPostgres: any;
  try {
    ({ default: EmbeddedPostgres } = await import("embedded-postgres"));
  } catch {
    throw new Error(
      "Desktop mode needs the optional dependency 'embedded-postgres'. Install it with: npm install --save-optional embedded-postgres"
    );
  }

  const dataDir = resolveDataDir();
  const clusterDir = path.join(dataDir, "pgdata");
  const isFirstRun = !fs.existsSync(path.join(clusterDir, "PG_VERSION"));
  fs.mkdirSync(dataDir, { recursive: true });

  const user = "tpce";
  const password = "tpce";
  const database = "tpce";
  const port = await freePort();

  const pg = new EmbeddedPostgres({
    databaseDir: clusterDir,
    user, password, port,
    persistent: true,
    // embedded-postgres writes initdb/postmaster output here; keep it quiet
    // but non-silent so real failures surface in the desktop log.
    onLog: (msg: string) => { if (/error|fatal|panic/i.test(msg)) console.warn(`[pg] ${msg.trim()}`); },
  });

  if (isFirstRun) {
    console.log(`[pg] initialising cluster at ${clusterDir} (first run, this takes a few seconds)`);
    await pg.initialise();
  }
  await pg.start();
  if (isFirstRun) await pg.createDatabase(database);

  const databaseUrl = `postgres://${user}:${password}@127.0.0.1:${port}/${database}`;
  console.log(`[pg] ready on port ${port}`);
  return { databaseUrl, stop: async () => { await pg.stop(); } };
}
```

VERIFY the `embedded-postgres` API before trusting the code above: read
`node_modules/embedded-postgres/dist/index.d.ts` and confirm the constructor
option names (`databaseDir`, `user`, `password`, `port`, `persistent`,
`onLog`) and the methods (`initialise`, `start`, `createDatabase`, `stop`).
Adapt the code to the real signatures and REPORT any differences.

Run: `npx vitest run tests/dataDir.test.ts` → 2 passed.

- [ ] **Step 4: Implement `src/desktop/main.ts`**

```ts
/** Desktop entrypoint: one process, no Docker, no Redis.
 *  Boot order matters — DATABASE_URL/PORT must be exported BEFORE any module
 *  that reads them (config/env, db/pool) is imported, hence the dynamic
 *  imports below. */
import { startEmbeddedPostgres } from "../db/embedded.js";

// CRITICAL: config/env.ts validates PORT at IMPORT time (`z.coerce.number()
// .default(4000)`), and db/pool.ts pulls it in transitively. Every env var
// the app reads must therefore be set BEFORE the first dynamic import below —
// static imports of app modules would be too late.
process.env.TPCE_MODE = "desktop";
process.env.NODE_ENV = process.env.NODE_ENV ?? "production";
process.env.PORT = process.env.PORT ?? "4173";

const pg = await startEmbeddedPostgres();
process.env.DATABASE_URL = pg.databaseUrl;

const { runMigrations } = await import("../db/migrate.js");
const applied = await runMigrations();
console.log(`[desktop] migrations: ${applied.length} applied`);

// Importing the server module starts Express listening on env.PORT (set above).
await import("../api/server.js");

const { startInProcessRunner } = await import("../worker/inProcessRunner.js");
const stopRunner = await startInProcessRunner();

console.log(`TPCE ready at http://localhost:${process.env.PORT}`);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[desktop] ${signal} — shutting down`);
  stopRunner();
  await pg.stop().catch((err) => console.warn(`[desktop] pg stop failed: ${err?.message ?? err}`));
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
```

KNOWN LIMITATION (acceptable for Phase 1, do NOT try to fix here): generated
media still resolves to `process.cwd()/data/media` (hardcoded in server.ts),
so desktop mode writes media relative to the install dir rather than the data
dir. Phase 2 (the Tauri shell) will make that path configurable — note it in
your report rather than changing server.ts now.

- [ ] **Step 4b: Gate the three media/render routes for desktop (REVIEW-MANDATED)**

`src/api/server.ts` has three routes that enqueue directly —
`POST /api/content/:id/synthesize`, `/render`, `/batch-render` — each with a
local `const { queues } = await import("../worker/queues.js")`. In desktop
mode that constructs an ioredis client with `maxRetriesPerRequest: null`, so
the request **hangs forever** instead of failing. READ all three handlers and
give each the same mode branch, using the SHARED guard so a manual trigger
cannot race the runner:

```ts
    if (isDesktop()) {
      const { runJobGuarded } = await import("../worker/inProcessRunner.js");
      void runJobGuarded("media").catch((err: any) =>
        console.warn(`[jobs] media failed: ${err?.message ?? err}`)
      );
      return void res.json({ ok: true, queued: "media" });
    }
```
(use `"render"` for the `/render` and `/batch-render` handlers; preserve each
route's existing response shape — READ them first and keep the same JSON keys
they return today).

ALSO update `POST /api/jobs/:name`'s desktop branch to call
`runJobGuarded(params.name)` instead of `JOBS[params.name]()` directly.

- [ ] **Step 5: Add the npm script**

In `package.json` scripts add (keep existing scripts untouched):
```json
    "desktop": "tsx src/desktop/main.ts",
```

- [ ] **Step 6: Gates**

Run: `npx vitest run` → 148 passed (146 + 2). `npx tsc -p tsconfig.json --noEmit` → clean.
Run: `npm run build` → succeeds (needed so desktop mode can serve `dist-web`).

- [ ] **Step 7: Commit**

```bash
git add src/db/embedded.ts src/desktop/main.ts tests/dataDir.test.ts package.json package-lock.json
git commit -m "feat(desktop): embedded Postgres + single-process desktop entrypoint (npm run desktop)"
```

---

### Task 5: U1 leftover — `effective` source defaults

**Files:**
- Modify: `src/services/ingestion/finance-newsletters.ts`, `src/services/ingestion/crypto-news.ts` (export default feed lists)
- Create: `src/services/ingestion/effectiveSources.ts`
- Modify: `src/api/server.ts` (`GET /api/pages/:id/sources` response)
- Modify: `src/web/components/settings/SourcesPanel.tsx` (dimmed default chips)
- Test: `tests/effectiveSources.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/effectiveSources.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { effectiveValue } from "../src/services/ingestion/effectiveSources.js";

describe("effectiveValue", () => {
  it("uses the override when it is non-empty", () => {
    expect(effectiveValue(["a", "b"], ["x"])).toEqual({ values: ["a", "b"], isDefault: false });
  });
  it("falls back to the default when the override is empty", () => {
    expect(effectiveValue([], ["x", "y"])).toEqual({ values: ["x", "y"], isDefault: true });
  });
  it("falls back when the override is undefined", () => {
    expect(effectiveValue(undefined, ["x"])).toEqual({ values: ["x"], isDefault: true });
  });
  it("returns an empty non-default list when neither exists", () => {
    expect(effectiveValue(undefined, [])).toEqual({ values: [], isDefault: true });
  });
});
```

Run: `npx vitest run tests/effectiveSources.test.ts` → FAIL.

- [ ] **Step 2: Export the adapter default feed lists**

READ `src/services/ingestion/finance-newsletters.ts` and `src/services/ingestion/crypto-news.ts`. Each has a module-level default feed array (finance: plain URL strings; crypto: objects with a `url` field). Add `export` to those arrays if they are not already exported, keeping their existing names. Record the exported names + shapes in your report — Step 3 must import them accurately.

- [ ] **Step 3: Implement `src/services/ingestion/effectiveSources.ts`**

```ts
import { classifyNiche } from "../../domain/niche-taxonomy.js";
import {
  GOOGLE_NEWS_QUERIES, RSS_FEEDS, SUBREDDITS, SUBSTACK_SLUGS, MEDIUM_TAGS, HN_KEYWORDS,
} from "./niche-queries.js";

export interface EffectiveField { values: string[]; isDefault: boolean }

/** An empty/absent override means "use the built-in default" — the UI shows
 *  the default dimmed so the user can see what is actually being used. */
export function effectiveValue(override: string[] | undefined, fallback: string[]): EffectiveField {
  if (override && override.length > 0) return { values: override, isDefault: false };
  return { values: fallback, isDefault: true };
}

/** Per-mapField effective values for a niche, mirroring what ingestForNiche
 *  actually resolves. Keys match SOURCE_REGISTRY configFields' mapField. */
export function buildEffectiveSources(
  nicheName: string,
  nicheKeywords: string[],
  map: Record<string, any> | null,
  financeDefaults: string[],
  cryptoDefaults: string[]
): Record<string, EffectiveField> {
  const category = classifyNiche(nicheName, nicheKeywords);
  const rssOverride = (map?.rssFeeds ?? []).map((f: any) => f?.url ?? f).filter(Boolean);
  return {
    redditSubreddits: effectiveValue(map?.redditSubreddits, SUBREDDITS[category] ?? []),
    rssFeeds: effectiveValue(rssOverride, RSS_FEEDS[category] ?? []),
    googleNewsQueries: effectiveValue(map?.googleNewsQueries, GOOGLE_NEWS_QUERIES[category] ?? []),
    mediumTags: effectiveValue(map?.mediumTags, MEDIUM_TAGS[category] ?? []),
    hackernewsTerms: effectiveValue(map?.hackernewsTerms, HN_KEYWORDS[category] ?? []),
    substackSlugs: effectiveValue(map?.substackSlugs, SUBSTACK_SLUGS[category] ?? []),
    financeFeeds: effectiveValue(map?.financeFeeds, financeDefaults),
    cryptoFeeds: effectiveValue(map?.cryptoFeeds, cryptoDefaults),
  };
}
```

Run: `npx vitest run tests/effectiveSources.test.ts` → 4 passed.

- [ ] **Step 4: Add `effective` to the sources route**

In `src/api/server.ts`, find `app.get("/api/pages/:id/sources"`. It currently returns `{ registry, map, keyPresent }`. Extend it to also fetch the page's niche and compute `effective` (adapt the default-array import names to what Step 2 recorded):

```ts
app.get("/api/pages/:id/sources", async (req, res, next) => {
  try {
    const { getCachedSourceMap } = await import("../services/ingestion/tag-generator.js");
    const { SOURCE_REGISTRY } = await import("../services/ingestion/sourceRegistry.js");
    const { buildEffectiveSources } = await import("../services/ingestion/effectiveSources.js");
    const map = await getCachedSourceMap(req.params.id);
    const keys: Record<string, boolean> = {};
    for (const s of SOURCE_REGISTRY) if (s.needsKey) keys[s.id] = Boolean(process.env[s.needsKey.env]);

    const nicheRow = await query(
      `SELECT n.name, n.keywords FROM pages p JOIN niches n ON n.id = p.niche_id WHERE p.id = $1`,
      [req.params.id]
    );
    let effective: Record<string, { values: string[]; isDefault: boolean }> = {};
    if (nicheRow.rows[0]) {
      const financeMod = await import("../services/ingestion/finance-newsletters.js");
      const cryptoMod = await import("../services/ingestion/crypto-news.js");
      const financeDefaults = (financeMod as any).FINANCE_FEEDS ?? [];
      const cryptoDefaults = ((cryptoMod as any).CRYPTO_FEEDS ?? []).map((f: any) => f?.url ?? f);
      effective = buildEffectiveSources(
        nicheRow.rows[0].name, nicheRow.rows[0].keywords ?? [], map, financeDefaults, cryptoDefaults
      );
    }
    res.json({ registry: SOURCE_REGISTRY, map, keyPresent: keys, effective });
  } catch (err) { next(err); }
});
```

Replace `FINANCE_FEEDS` / `CRYPTO_FEEDS` with the REAL exported names from Step 2.

- [ ] **Step 5: Render dimmed defaults in SourcesPanel**

READ `src/web/components/settings/SourcesPanel.tsx`. Changes:

1. Add `effective` to the loaded state:
```tsx
  const [effective, setEffective] = useState<Record<string, { values: string[]; isDefault: boolean }>>({});
```
and in `load()`'s `.then`, add `setEffective(d.effective ?? {});`.

2. Inside the config-field block, after the existing chip list + input, render the default hint when the user's own list is empty:

```tsx
              {fieldValues(f).length === 0 && effective[f.mapField]?.isDefault && effective[f.mapField].values.length > 0 && (
                <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>using defaults:</span>
                  {effective[f.mapField].values.slice(0, 6).map((v) => (
                    <span key={v} className="badge badge-muted" style={{ opacity: 0.55 }}>{v}</span>
                  ))}
                  {effective[f.mapField].values.length > 6 && (
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                      +{effective[f.mapField].values.length - 6} more
                    </span>
                  )}
                </div>
              )}
```

- [ ] **Step 6: Gates + live check**

Run: `npx vitest run` → 152 passed (148 + 4). `npx tsc -p tsconfig.json --noEmit` → clean. `npm run build` → succeeds.

Live (docker up, spare port):
```bash
PORT=4712 npx tsx src/api/server.ts > /tmp/d2-eff.log 2>&1 &
sleep 6
PAGE=$(curl -s http://localhost:4712/api/pages | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['id'])")
curl -s "http://localhost:4712/api/pages/$PAGE/sources" | python3 -c "import json,sys; d=json.load(sys.stdin); print({k: (v['isDefault'], len(v['values'])) for k,v in d['effective'].items()})"
pkill -f "tsx src/api/server.ts"
```
Expected: a dict of mapField → (isDefault, count) with non-zero counts for the niche's category defaults.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(sources): expose effective defaults and show them dimmed when no override is set"
```

---

### Task 6: Desktop E2E + docs

**Files:** `README.md`, `docs/ARCHITECTURE.md`, `.env.example`; verification otherwise.

- [ ] **Step 1: Cold-start proof (temp data dir, spare port)**

The user's docker stack may be running — desktop mode must not touch it. Use a temp dir and a distinct port:

```bash
export TPCE_TEST_DIR=$(mktemp -d)
TPCE_DATA_DIR=$TPCE_TEST_DIR PORT=4713 npm run desktop > /tmp/d2-desktop.log 2>&1 &
sleep 60   # first run initialises the PG cluster
grep -E "\[pg\]|migrations|TPCE ready|runner" /tmp/d2-desktop.log | head -12
curl -s -o /dev/null -w "ui: %{http_code}\n" http://localhost:4713/
curl -s -o /dev/null -w "health: %{http_code}\n" http://localhost:4713/api/health
curl -s http://localhost:4713/api/inbox | head -c 120
```
Expected: `[pg] initialising cluster…`, `[pg] ready on port …`, `migrations: 8 applied`, `[runner] catch-up pass: post → schedule → …`, `TPCE ready at http://localhost:4713`, `ui: 200`, `health: 200`, and a JSON inbox payload. **Report the actual log lines.**

- [ ] **Step 2: Restart persistence proof**

```bash
pkill -f "tsx src/desktop/main.ts"; sleep 3
TPCE_DATA_DIR=$TPCE_TEST_DIR PORT=4713 npm run desktop > /tmp/d2-desktop2.log 2>&1 &
sleep 25
grep -E "initialising|migrations|TPCE ready" /tmp/d2-desktop2.log
```
Expected: NO "initialising" line (cluster reused) and `migrations: 0 applied` — proving data persists across restarts.

- [ ] **Step 3: Catch-up proof**

While the second instance runs, insert a due publish job directly into the desktop DB and confirm the runner publishes it. Get the desktop DB URL from the log line `[pg] ready on port <PORT>`:

```bash
PGPORT=$(grep -o "ready on port [0-9]*" /tmp/d2-desktop2.log | grep -o "[0-9]*")
export PGURL="postgres://tpce:tpce@127.0.0.1:$PGPORT/tpce"
# seed a niche → page → topic → content_item → scheduled job dated in the past
npx tsx -e "
import pg from 'pg';
const c = new pg.Client(process.env.PGURL); await c.connect();
const n = (await c.query(\"INSERT INTO niches (name, keywords, monetization_keywords, negative_keywords, target_persona) VALUES ('E2E','{a}','{}','{}','p') RETURNING id\")).rows[0].id;
const p = (await c.query(\"INSERT INTO pages (niche_id,name,platform,handle,brand) VALUES (\$1,'E2E','instagram','@e2e','{}') RETURNING id\",[n])).rows[0].id;
const t = (await c.query(\"INSERT INTO topics (niche_id,title,keywords,sources) VALUES (\$1,'E2E catch-up','{a}','{manual}') RETURNING id\",[n])).rows[0].id;
const ci = (await c.query(\"INSERT INTO content_items (topic_id,page_id,type,status,payload) VALUES (\$1,\$2,'post','approved','{\\\"hook\\\":\\\"h\\\",\\\"caption\\\":\\\"c\\\"}') RETURNING id\",[t,p])).rows[0].id;
await c.query(\"INSERT INTO publish_jobs (content_item_id,page_id,platform,status,scheduled_at,formatted_caption) VALUES (\$1,\$2,'instagram','scheduled', now() - interval '2 hours','c')\",[ci,p]);
console.log('seeded'); await c.end();
"
# restart so the launch catch-up pass runs
pkill -f "tsx src/desktop/main.ts"; sleep 3
TPCE_DATA_DIR=$TPCE_TEST_DIR PORT=4713 npm run desktop > /tmp/d2-desktop3.log 2>&1 &
sleep 30
npx tsx -e "
import pg from 'pg';
const c = new pg.Client(process.env.PGURL); await c.connect();
console.log((await c.query('SELECT status, external_post_id FROM publish_jobs')).rows);
console.log((await c.query('SELECT job, last_status FROM job_runs ORDER BY job')).rows);
await c.end();
"
```
Expected: the job is `published` with a `stub-…` external id (dry-run), and `job_runs` has `ok` rows for post/schedule/analyze. **Report both tables.**

- [ ] **Step 4: Clean up**

```bash
pkill -f "tsx src/desktop/main.ts"; sleep 2
rm -rf "$TPCE_TEST_DIR"
```
Confirm the user's dev stack is untouched (`docker compose ps` still healthy; their :4000 process, if it was running, still alive).

- [ ] **Step 5: Docs**

`README.md` — add a **Desktop mode (no Docker)** section under Quickstart:
````markdown
### Desktop mode (no Docker, no Redis)

```bash
npm install
npm run build
npm run desktop
```
Postgres is embedded and stored in your app-data folder (override with
`TPCE_DATA_DIR`); background jobs run in-process on an elapsed-time
schedule with a catch-up pass at launch, so a post scheduled for 17:00
goes out when you next open the app. No Docker or Redis required.
````

`docs/ARCHITECTURE.md` — add module **13. Run modes** describing: `TPCE_MODE=server` (BullMQ + Redis + external PG, separate api/worker) vs `desktop` (single process, embedded PG, `job_runs`-driven elapsed-time scheduler, launch catch-up, no bull-board), and that job bodies are shared via `src/worker/jobs.ts`.

`.env.example` — add with comments:
```
# Run mode: server (default; Docker/cloud) or desktop (embedded Postgres, no Redis)
TPCE_MODE=
# Desktop mode data directory (embedded Postgres cluster + media). Defaults to your OS app-data dir.
TPCE_DATA_DIR=
```

- [ ] **Step 6: Final gates + commit**

Run `npx vitest run` (152), `npx tsc -p tsconfig.json --noEmit`, `npm run build`, and `npm run db:init` twice against the docker dev DB (idempotent, 8 applied → up to date).

```bash
git add -A
git commit -m "feat: desktop mode verified end-to-end — cold start, persistence, launch catch-up; docs"
```
