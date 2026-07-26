/** Desktop entrypoint: one process, no Docker, no Redis.
 *  Boot order matters — DATABASE_URL/PORT must be exported BEFORE any module
 *  that reads them (config/env, db/pool) is imported, hence the dynamic
 *  imports below. */
import { resolveDataDir, startEmbeddedPostgres } from "../db/embedded.js";

// CRITICAL: config/env.ts validates PORT at IMPORT time (`z.coerce.number()
// .default(4000)`), and db/pool.ts pulls it in transitively. Every env var
// the app reads must therefore be set BEFORE the first dynamic import below —
// static imports of app modules would be too late.
process.env.CONTENTLOOP_MODE = "desktop";
process.env.NODE_ENV = process.env.NODE_ENV ?? "production";
process.env.PORT = process.env.PORT ?? "4173";

let pg: Awaited<ReturnType<typeof startEmbeddedPostgres>>;
try {
  pg = await startEmbeddedPostgres();
} catch (err) {
  // embedded-postgres rejects with NO argument when the server exits during
  // start (stale postmaster.pid after a force-quit, or a second TPCE instance
  // on the same data dir), so `err` is usually undefined — print something
  // actionable instead of a blank unhandled rejection.
  console.error(
    `[desktop] startup failed: ${err ?? "Postgres exited during start"}\n` +
    `  Data dir: ${resolveDataDir()}\n` +
    `  Another ContentLoop instance may already be running, or a previous run was\n` +
    `  force-quit and left a stray postgres process holding this data dir.`
  );
  process.exit(1);
}
process.env.DATABASE_URL = pg.databaseUrl;

const { runMigrations } = await import("../db/migrate.js");
const applied = await runMigrations();
console.log(`[desktop] migrations: ${applied.length} applied`);

// Importing the server module starts Express listening on env.PORT (set above).
await import("../api/server.js");

// Announce readiness once the socket ACTUALLY accepts connections, and
// BEFORE the catch-up pass (which can run for minutes on a populated DB —
// ingest/score/generate are LLM- and network-bound). Phase 2's shell greps
// this line to know when to open its window, so it must not fire early:
// importing the server module only starts app.listen(), it does not wait for
// it, so poll health rather than assuming.
const readyUrl = `http://localhost:${process.env.PORT}`;
for (let attempt = 0; attempt < 100; attempt++) {
  try {
    const res = await fetch(`${readyUrl}/api/health`);
    if (res.ok) break;
  } catch { /* not accepting yet */ }
  await new Promise((r) => setTimeout(r, 100));
}
console.log(`ContentLoop ready at ${readyUrl}`);

const { startInProcessRunner } = await import("../worker/inProcessRunner.js");
const stopRunner = await startInProcessRunner();

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
