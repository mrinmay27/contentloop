// Helpers the launcher scripts shell out to. Kept in Node (not shell) so the
// fragile bits are unit-tested and behave identically on every platform.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/** Minimum Node major ContentLoop runs on. Deliberately LOWER than the pinned
 *  portable download (v24) — an already-installed v20 or v22 is reused as-is,
 *  and only machines with nothing suitable pay for the download. */
export const MIN_NODE_MAJOR = 20;

/** True when `version` ("v24.18.0" or "24.18.0") is new enough to run ContentLoop. */
export function isNodeVersionOk(version) {
  if (typeof version !== "string") return false;
  const m = version.trim().match(/^v?(\d+)\./);
  if (!m) return false;
  return Number(m[1]) >= MIN_NODE_MAJOR;
}

/** Short digest of the lockfile contents — lets the launcher skip `npm ci`
 *  when nothing changed since the last successful install. */
export function depsHash(lockContents) {
  return createHash("sha256").update(lockContents).digest("hex").slice(0, 16);
}

/** CLI entry: `node lib.mjs deps-hash <path>` prints the hash of a lockfile,
 *  `node lib.mjs node-ok <version>` exits 0/1. Shell calls these. */
if (process.argv[1] && process.argv[1].endsWith("lib.mjs")) {
  const [, , cmd, arg] = process.argv;
  if (cmd === "deps-hash") {
    process.stdout.write(depsHash(readFileSync(arg, "utf8")));
  } else if (cmd === "node-ok") {
    process.exit(isNodeVersionOk(arg) ? 0 : 1);
  }
}
