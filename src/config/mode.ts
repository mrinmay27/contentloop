/** Runtime mode. `server` (default) = BullMQ + Redis + external Postgres,
 *  separate api/worker processes. `desktop` = one process, in-process
 *  scheduler, embedded Postgres, no Redis.
 *
 *  CONTENTLOOP_MODE is the current name; TPCE_MODE is still honoured because
 *  the project was called TPCE before the rename, and an existing .env must
 *  not silently stop working. */
export type RunMode = "server" | "desktop";

/** @deprecated Former name, kept so existing imports keep compiling. */
export type TpceMode = RunMode;

export function resolveMode(): RunMode {
  const raw = process.env.CONTENTLOOP_MODE ?? process.env.TPCE_MODE;
  return raw?.trim().toLowerCase() === "desktop" ? "desktop" : "server";
}

export const isDesktop = (): boolean => resolveMode() === "desktop";
