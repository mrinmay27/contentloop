# Sprint D2 (Phase 1) — Desktop Mode: Design Spec

> Status: Approved design, 2026-07-24
> Goal: make TPCE runnable as a single self-contained process with NO Docker,
> NO Redis, and NO external Postgres — the prerequisite for a native
> Mac/Windows installer (Phase 2 = Tauri shell + signed installers).
> Also folds in the leftover U1 polish (`effective` source defaults).

## The reframe (user-driven, and it changes the scheduling model)

The 24/7 assumption was wrong for the target user. A solo creator posting
1–2×/day wants a **native app they open**, not a server they operate.

TPCE tolerates this better than expected because of Sprint A–C decisions:
- `publishDueJobs` selects `scheduled_at <= now()` — a 17:00 post simply
  goes out at 19:30 when the app is next opened. **Catch-up is inherent.**
- Metrics capture retries missed points until a 7d cutoff; learning folds
  24h snapshots; the claim-once ledger makes catch-up runs idempotent.

Known, accepted degradation: 1h-window features (reactor overperformance
detection, 1h capture points) weaken if the app is closed right after
posting — `isTooStaleForRealCapture` correctly drops late real captures.
The daily loop (ingest → score → generate → approve → publish → learn)
remains fully intact.

**Consequence for scheduling:** wall-clock cron (`0 7 * * *`) is the WRONG
model for an app that isn't always running — a 07:00 daily ingest simply
never fires for someone who opens the app at 10am. Desktop mode instead
uses **elapsed-time scheduling with persisted last-run timestamps**: "run
ingest if it hasn't run in ≥20h". This is strictly better for intermittent
operation and needs no cron dependency.

## Decisions

1. **`TPCE_MODE`** env: `server` (default, unchanged behavior — BullMQ +
   Redis + external Postgres + separate api/worker processes) or `desktop`
   (single process: API + in-process scheduler + embedded Postgres).
2. **Job functions are extracted from BullMQ** into plain async functions
   (`src/worker/jobs.ts`). BullMQ and the in-process runner both become thin
   callers. This is the core refactor and the main risk-reduction step.
3. **In-process runner** uses persisted last-run timestamps (`job_runs`
   table, migration 008) + `setInterval` ticks; no new dependency, no cron.
4. **Embedded Postgres** via `embedded-postgres` (validated: 1M
   downloads/mo, all target platforms). Data lives in an app-data dir
   (`TPCE_DATA_DIR`, default per-OS app dir). Migrations run at boot.
5. **Catch-up on launch**: desktop start runs the due-work pass immediately
   (post + analyze + schedule) before entering the tick loop, so an app
   opened at 19:30 publishes the 17:00 job within seconds.
6. **Redis-dependent surfaces are mode-gated**: bull-board (`/queues`) and
   the queue-backed `POST /api/jobs/:name` are only mounted in server mode;
   desktop mode invokes job functions directly (same route, same response
   shape — the UI must not care which mode it's in).
7. **Phase 2 is NOT in this sprint**: no Tauri, no installers, no code
   signing. Phase 1 ships `npm run desktop` — a fully working, Docker-free
   single process — which is independently valuable (it's also the easiest
   possible self-host path) and de-risks everything Phase 2 needs.
8. **U1 leftover folded in**: `GET /api/pages/:id/sources` gains the
   `effective` map (spec §2 of U1) and SourcesPanel renders category/adapter
   defaults as grayed-out placeholders when an override is empty.

## 1. Job extraction — `src/worker/jobs.ts`

Every current `new Worker("<name>", async () => { ...body... })` body moves
verbatim into an exported async function:

```ts
export const JOBS = {
  ingest, score, generate, media, render, schedule, post, analyze,
} as const;
export type JobName = keyof typeof JOBS;
```

Rules:
- Bodies move UNCHANGED (they already contain all dynamic imports and
  error isolation). No behavior edits in this task — it must be a pure
  move, verifiable by diff review.
- `src/worker/index.ts` (server mode) becomes thin: it wires each
  `JOBS[name]` into a `new Worker(...)` with the SAME concurrency options
  it has today (analyze: 1, post: 1, media: 1, render: 1, others: 3).
- `src/worker/queues.ts` is untouched (server mode only).

## 2. In-process runner — `src/worker/inProcessRunner.ts`

Migration `008_job_runs.sql`:

```sql
CREATE TABLE IF NOT EXISTS job_runs (
  job         TEXT PRIMARY KEY,
  last_run_at TIMESTAMPTZ NOT NULL,
  last_status TEXT NOT NULL CHECK (last_status IN ('ok','failed')),
  last_error  TEXT
);
```

Cadence table (elapsed-time, mirroring server-mode intent):

| job | min interval | catch-up on launch |
|---|---|---|
| ingest | 20h | yes |
| score | 20h (and after ingest) | yes |
| generate | 20h (and after score) | yes |
| media | 20h | no (heavy) |
| render | 20h | no (heavy) |
| schedule | 30m | yes |
| post | 10m | **yes (first)** |
| analyze | 60m | yes |

Runner behavior:
- `startInProcessRunner()`: run a **catch-up pass** (post → schedule →
  analyze → ingest/score/generate if due), then `setInterval` every 60s
  evaluating "is each job due?" against `job_runs`.
- Jobs run **sequentially within a tick** (single process, no concurrency
  benefit; avoids the media/render CPU spikes overlapping the UI).
- Each run wrapped: record `last_run_at`/`last_status`/`last_error`; a
  failing job never stops the loop or the process.
- A job already running is never re-entered (in-memory guard).

## 3. Embedded Postgres — `src/db/embedded.ts`

```ts
export async function startEmbeddedPostgres(): Promise<string> // returns DATABASE_URL
```
- Data dir: `TPCE_DATA_DIR` env, else per-OS app dir
  (`~/Library/Application Support/TPCE` / `%APPDATA%\TPCE` /
  `~/.local/share/tpce`), subdir `pgdata`.
- Port: picks a free port (avoid clashing with a user's real Postgres);
  persisted alongside so restarts reuse it when free.
- First run: `initialise()` then `start()`; subsequent runs: `start()` only.
- On process exit (SIGINT/SIGTERM/beforeExit): graceful `stop()`.
- Desktop boot order: start PG → set `process.env.DATABASE_URL` → import
  pool/migrations (dynamic, AFTER the env is set) → run migrations →
  start API + runner.

`embedded-postgres` is added as an **optionalDependency** so server-mode
installs (Docker/cloud) don't pay the ~100MB binary download; desktop
entry fails with a clear message if it's absent.

## 4. Desktop entrypoint — `src/desktop/main.ts` + `npm run desktop`

Single process, in order:
1. Resolve data dir; start embedded Postgres; export DATABASE_URL.
2. Run migrations (existing `runMigrations`).
3. Start the Express app (existing server module, `NODE_ENV=production`
   static serving of `dist-web`) on a free port.
4. `startInProcessRunner()`.
5. Print `TPCE ready at http://localhost:<port>` (a stable, greppable line
   Phase 2's Tauri shell will parse).

## 5. Mode gating in `src/api/server.ts`

- Top-level `import` of `./queues.js`-dependent bull-board is replaced by a
  **conditional dynamic import** in server mode only (importing it in
  desktop mode would eagerly connect ioredis and crash).
- `POST /api/jobs/:name`: server mode enqueues (today's behavior); desktop
  mode calls `JOBS[name]()` (fire-and-forget with logging) and returns the
  same `{ ok: true, queued: name }` shape.
- `/queues` (+ its API_TOKEN gate) only mounted in server mode.

## 6. U1 leftover — `effective` source values

`GET /api/pages/:id/sources` response gains:
```ts
effective: Record<string /* mapField */, string[]>
```
computed from the same category defaults `ingestForNiche` uses
(`SUBREDDITS`, `RSS_FEEDS`, `SUBSTACK_SLUGS`, `GOOGLE_NEWS_QUERIES` from
`niche-queries.ts`, plus the finance/crypto adapter default lists exported
for this purpose). SourcesPanel renders them as dimmed chips with a
"default" tag when the user's override for that field is empty, so the
"everything a user can see, a user can edit" promise holds.

## 7. Testing

Pure/unit (vitest):
- `isJobDue(lastRunAt, minIntervalMs, now)` — due when never run, due at
  exactly the interval, not due before, catch-up flags.
- Job registry parity: every `JobName` has a function and every job named
  in the cadence table exists in `JOBS` (mirrors the U1 registry-parity
  test pattern).
- `effective` merge helper: override present → override; empty → default.

E2E (manual, this machine):
- **Server mode unchanged**: existing docker stack + `npm run dev` still
  works (this is the regression risk of the extraction — must be proven).
- **Desktop mode cold start**: with docker stopped, `TPCE_DATA_DIR=<tmp>
  npm run desktop` → embedded PG initialises, 8 migrations apply, UI
  serves, `/api/inbox` responds, runner logs a catch-up pass; kill and
  restart → reuses the same data dir (data persists, PG restarts clean).
- **Catch-up proof**: insert a `scheduled` publish_job dated in the past
  into the desktop DB, start desktop mode, observe it published within
  seconds of launch.

## Out of scope (Phase 2 / later)

- Tauri shell, tray icon, launch-at-login, `.dmg`/`.msi` bundling, code
  signing + notarization, auto-update.
- First-run wizard UX (key paste, first page) — Phase 2 with the shell.
- Sprint D core (remixing, competitor ingestion) — next sprint after D2.
- SQLite/PGlite (rejected: our SQL uses advisory locks, `FOR UPDATE SKIP
  LOCKED`, JSONB, arrays, CTEs — real Postgres only).
