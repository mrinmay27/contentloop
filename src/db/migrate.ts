import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, withTransaction } from "./pool.js";

// NOTE (Sprint U1 Task 7): `npm run build`'s tsc pass does NOT copy .sql
// files into dist/ — only .ts → .js. So a compiled dist/src/db/migrate.js
// has no dist/src/db/migrations directory of its own. resolveMigrationsDir()
// handles this three ways, in order: (1) MIGRATIONS_DIR env var — what the
// Docker image uses, since the Dockerfile COPYs src/db/migrations to
// /app/src/db/migrations and sets the env var to point there; (2) the
// tsx dev path (src/db/migrations, sibling of this file); (3) a fallback
// that walks up from dist/src/db to the repo root and back down into
// src/db/migrations — useful for running the compiled output directly
// against a repo checkout (no Docker) without setting the env var.
function resolveMigrationsDir(): string {
  if (process.env.MIGRATIONS_DIR) return process.env.MIGRATIONS_DIR;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "migrations"),                 // tsx: src/db/migrations
    path.join(here, "../../../src/db/migrations"), // dist/src/db → repo src fallback
  ];
  for (const c of candidates) {
    try { if (fsSync.existsSync(c)) return c; } catch { /* keep looking */ }
  }
  return candidates[0];
}
const MIGRATIONS_DIR = resolveMigrationsDir();

/** Pure: which .sql files still need applying, in filename order. */
export function pendingMigrations(files: string[], applied: string[]): string[] {
  const appliedSet = new Set(applied);
  return files
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) => !appliedSet.has(f));
}

/** Apply all pending migrations. Returns the filenames applied. */
export async function runMigrations(dir: string = MIGRATIONS_DIR): Promise<string[]> {
  // Serialize concurrent runners (dev-bootstrap racing a manual db:init):
  // without this, two simultaneous CREATE TABLE IF NOT EXISTS bootstraps can
  // collide on a pg_type unique violation. Advisory locks are session-scoped,
  // so lock and unlock must run on the SAME dedicated connection.
  const LOCK_KEY = 727270001; // arbitrary app-unique constant
  const lockClient = await pool.connect();
  try {
    await lockClient.query(`SELECT pg_advisory_lock($1)`, [LOCK_KEY]);
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version    TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      const files = await fs.readdir(dir);
      const appliedResult = await pool.query(`SELECT version FROM schema_migrations`);
      const applied = appliedResult.rows.map((r: any) => r.version as string);
      const pending = pendingMigrations(files, applied);

      for (const file of pending) {
        const sql = await fs.readFile(path.join(dir, file), "utf8");
        try {
          await withTransaction(async (client) => {
            await client.query(sql);
            await client.query(`INSERT INTO schema_migrations (version) VALUES ($1)`, [file]);
          });
        } catch (err) {
          throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err });
        }
        console.log(`[migrate] applied ${file}`);
      }
      if (pending.length === 0) console.log(`[migrate] up to date (${applied.length} applied)`);
      return pending;
    } finally {
      await lockClient.query(`SELECT pg_advisory_unlock($1)`, [LOCK_KEY]);
    }
  } finally {
    lockClient.release();
  }
}
