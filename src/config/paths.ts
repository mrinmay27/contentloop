/** Where generated and uploaded media lives.
 *
 *  Four modules previously each hardcoded `process.cwd()/data/media`, so media
 *  landed next to wherever the app happened to be launched from rather than
 *  with the rest of a user's data. That was tolerable when everything in there
 *  was regenerable (stock footage, TTS, renders); it is not once creators
 *  upload their own irreplaceable footage.
 *
 *  Backwards compatible on purpose: only an explicit CONTENTLOOP_DATA_DIR
 *  moves the location. Existing installs keep `cwd/data/media`, so nobody's
 *  media becomes unreachable on upgrade.
 */
import path from "node:path";

/** The directory holding this install's data, honouring CONTENTLOOP_DATA_DIR. */
export function resolveDataDir(): string {
  const override = process.env.CONTENTLOOP_DATA_DIR ?? process.env.TPCE_DATA_DIR;
  if (override && override.trim()) return path.resolve(override.trim());
  return path.resolve(process.cwd(), "data");
}

export function resolveMediaDir(): string {
  const override = process.env.CONTENTLOOP_DATA_DIR ?? process.env.TPCE_DATA_DIR;
  if (override && override.trim()) return path.join(path.resolve(override.trim()), "media");
  return path.resolve(process.cwd(), "data/media");
}
