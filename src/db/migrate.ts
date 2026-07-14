import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, withTransaction } from "./pool.js";

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

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
    await withTransaction(async (client) => {
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (version) VALUES ($1)`, [file]);
    });
    console.log(`[migrate] applied ${file}`);
  }
  if (pending.length === 0) console.log(`[migrate] up to date (${applied.length} applied)`);
  return pending;
}
