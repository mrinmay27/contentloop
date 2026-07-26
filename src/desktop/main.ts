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
