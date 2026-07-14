import { pool } from "../src/db/pool.js";
import { runMigrations } from "../src/db/migrate.js";

try {
  const applied = await runMigrations();
  console.log(`Migrations complete — ${applied.length} applied.`);
} catch (err) {
  console.error("Migration failed:", err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
