/**
 * dev-bootstrap.ts
 * 
 * Single-command dev startup:
 *   1. Ensures Docker Desktop / daemon is running
 *   2. Starts Postgres + Redis via docker-compose (idempotent)
 *   3. Waits for both services to be healthy
 *   4. Auto-initializes the DB schema if tables don't exist
 *   5. Launches API + Worker + Vite web server via concurrently
 */

import { execSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ─── Helpers ──────────────────────────────────────────────

const log = (tag: string, msg: string) => {
  const colors: Record<string, string> = {
    "🐳 docker": "\x1b[36m",   // cyan
    "🗄️  postgres": "\x1b[35m", // magenta
    "🔴 redis": "\x1b[31m",     // red
    "📦 schema": "\x1b[33m",    // yellow
    "🚀 engine": "\x1b[32m",    // green
    "❌ error": "\x1b[91m",     // bright red
  };
  const reset = "\x1b[0m";
  const color = colors[tag] ?? "\x1b[37m";
  console.log(`${color}[${tag}]${reset} ${msg}`);
};

function exec(cmd: string, opts?: { cwd?: string }): string {
  return execSync(cmd, {
    cwd: opts?.cwd ?? ROOT,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── 1. Docker Daemon Check ──────────────────────────────

async function ensureDocker(): Promise<void> {
  log("🐳 docker", "Checking Docker daemon...");
  try {
    exec("docker info");
    log("🐳 docker", "Docker daemon is running ✓");
    return;
  } catch {
    // not running — try to start it (macOS only)
  }

  log("🐳 docker", "Docker not running. Attempting to start Docker runtime...");

  // Try strategies in order; fall through to poll on any failure
  const launched = (() => {
    // 1. Colima (lightweight Docker runtime for macOS, common with brew-installed docker)
    try {
      exec("which colima");
      exec("colima start", { cwd: ROOT }); // may take ~20s on first run
      return true;
    } catch { /* next */ }
    // 2. macOS GUI app (Docker Desktop installed via .dmg)
    for (const name of ['"Docker Desktop"', "Docker"]) {
      try { exec(`open -a ${name}`); return true; } catch { /* next */ }
    }
    // 3. Homebrew service fallback
    for (const svc of ["docker-desktop", "docker"]) {
      try { exec(`brew services start ${svc}`); return true; } catch { /* next */ }
    }
    return false;
  })();

  if (!launched) {
    log("🐳 docker", "Could not auto-start Docker — please run 'colima start' manually, then wait…");
  }

  // Poll up to 90 s for the daemon to become ready
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    try {
      exec("docker info");
      log("🐳 docker", `Docker daemon is ready ✓ (took ~${i + 1}s)`);
      return;
    } catch {
      if (i % 15 === 14) log("🐳 docker", `Still waiting for Docker… (${i + 1}s)`);
    }
  }

  log("❌ error", "Docker didn't start within 90 s. Please start Docker Desktop manually and run npm run dev again.");
  process.exit(1);
}

// ─── 2. Start Docker Compose Services ────────────────────

function startDockerServices(): void {
  log("🐳 docker", "Starting Postgres & Redis via docker-compose...");
  try {
    exec("docker compose up -d", { cwd: ROOT });
    log("🐳 docker", "Containers started ✓");
  } catch {
    // Fallback to docker-compose (v1)
    try {
      exec("docker-compose up -d", { cwd: ROOT });
      log("🐳 docker", "Containers started (docker-compose v1) ✓");
    } catch (e) {
      log("❌ error", `Failed to start containers: ${e}`);
      process.exit(1);
    }
  }
}

// ─── 3. Wait for Service Health ──────────────────────────

async function waitForPostgres(maxRetries = 30): Promise<void> {
  log("🗄️  postgres", "Waiting for Postgres to be healthy...");
  for (let i = 0; i < maxRetries; i++) {
    try {
      exec(
        `docker compose exec -T postgres pg_isready -U theme -d theme_engine`,
        { cwd: ROOT }
      );
      log("🗄️  postgres", `Postgres is ready ✓ (${i + 1} attempt${i > 0 ? "s" : ""})`);
      return;
    } catch {
      // silent retry
    }
    await sleep(1000);
  }
  log("❌ error", `Postgres didn't become healthy after ${maxRetries}s`);
  process.exit(1);
}

async function waitForRedis(maxRetries = 20): Promise<void> {
  log("🔴 redis", "Waiting for Redis to be healthy...");
  for (let i = 0; i < maxRetries; i++) {
    try {
      const result = exec(
        `docker compose exec -T redis redis-cli ping`,
        { cwd: ROOT }
      );
      if (result.includes("PONG")) {
        log("🔴 redis", `Redis is ready ✓ (${i + 1} attempt${i > 0 ? "s" : ""})`);
        return;
      }
    } catch {
      // silent retry
    }
    await sleep(1000);
  }
  log("❌ error", `Redis didn't become healthy after ${maxRetries}s`);
  process.exit(1);
}

// ─── 4. Auto-Init DB Schema ─────────────────────────────

async function ensureSchema(): Promise<void> {
  log("📦 schema", "Applying schema migrations...");

  // Dynamic import to load dotenv/env before pg
  const { pool } = await import("../src/db/pool.js");

  try {
    // Always run schema.sql — every statement is idempotent:
    // CREATE TABLE IF NOT EXISTS, ALTER TABLE ADD COLUMN IF NOT EXISTS,
    // CREATE INDEX IF NOT EXISTS. Safe to re-run on every boot so new
    // migrations (like source_url) are picked up without dropping the DB.
    const schemaPath = path.join(ROOT, "src/db/schema.sql");
    const schema = await fs.readFile(schemaPath, "utf8");
    await pool.query(schema);
    log("📦 schema", "Schema up to date ✓");
    await pool.end();
  } catch (error) {
    log("❌ error", `Schema migration failed: ${error}`);
    await pool.end();
    process.exit(1);
  }
}

// ─── 5. Launch App Services ─────────────────────────────

function launchApp(): ChildProcess {
  log("🚀 engine", "Starting API + Worker + Web...\n");

  const cmd = [
    "npx concurrently",
    "--kill-others",
    '--prefix "[{name}]"',
    "--names API,WORKER,WEB",
    "--prefix-colors magenta,yellow,cyan",
    '"npm run dev:api"',
    '"npm run dev:worker"',
    '"npm run dev:web"',
  ].join(" ");

  const child = spawn(cmd, {
    cwd: ROOT,
    stdio: "inherit",
    shell: true,
  });

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });

  return child;
}

// ─── Main ────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("\n\x1b[1m\x1b[36m╔══════════════════════════════════════════════╗\x1b[0m");
  console.log("\x1b[1m\x1b[36m║   🎨 Theme Page Content Engine — Dev Mode    ║\x1b[0m");
  console.log("\x1b[1m\x1b[36m╚══════════════════════════════════════════════╝\x1b[0m\n");

  await ensureDocker();
  startDockerServices();

  await Promise.all([waitForPostgres(), waitForRedis()]);

  await ensureSchema();

  launchApp();
}

main().catch((err) => {
  log("❌ error", `Fatal: ${err}`);
  process.exit(1);
});
