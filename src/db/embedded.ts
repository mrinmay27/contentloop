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
