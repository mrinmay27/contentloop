/** Whether ContentLoop looks for topics on its own for a given page.
 *
 *  Manual turns off unattended DISCOVERY only. On-demand AI — script and
 *  caption generation, the subscription bridges, Whisper transcription — stays
 *  fully available, as do scheduling, publishing and the learning loop.
 *
 *  Only `ingest` consults this. `score` selects WHERE state='IDEA' and
 *  `generate` works from selected topics, neither of which a manual niche
 *  produces, so gating them too would be dead code.
 *
 *  Pure — no I/O.
 */

export type DiscoveryMode = "auto" | "manual";

export function resolveDiscoveryMode(
  brand: { discovery?: string } | undefined
): DiscoveryMode {
  // Anything unrecognised resolves to auto: accidentally disabling a user's
  // pipeline is far worse than ignoring a junk value.
  return brand?.discovery === "manual" ? "manual" : "auto";
}

/** A niche is ingested when ANY page under it wants discovery, so one
 *  automatic page is never starved by a manual sibling. A niche with no pages
 *  still ingests — nothing has opted out. */
export function shouldIngestNiche(
  pages: Array<{ brand?: { discovery?: string } }>
): boolean {
  if (pages.length === 0) return true;
  return pages.some((page) => resolveDiscoveryMode(page.brand) === "auto");
}
