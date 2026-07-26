/** Runtime mode. `server` (default) = BullMQ + Redis + external Postgres,
 *  separate api/worker processes. `desktop` = one process, in-process
 *  scheduler, embedded Postgres, no Redis. */
export type TpceMode = "server" | "desktop";

export function resolveMode(): TpceMode {
  return process.env.TPCE_MODE?.trim().toLowerCase() === "desktop" ? "desktop" : "server";
}

export const isDesktop = (): boolean => resolveMode() === "desktop";
