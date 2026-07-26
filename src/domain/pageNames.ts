/**
 * Page-name suggestions for step 3 of the create-page wizard.
 *
 * These used to be a hardcoded array of ten AI-themed names, so choosing
 * "Fitness & Health" still offered "AI Tools Daily" and "Build With AI", and
 * the Regenerate button had no handler at all. Generating from the niche with
 * a seed makes both the suggestions and Regenerate real, and keeps the whole
 * thing deterministic and testable without an LLM call (name suggestions must
 * work with no API key configured).
 */

/** Templates are chosen so they read naturally with a one or two word core. */
const TEMPLATES: ((core: string) => string)[] = [
  (c) => `${c} Daily`,
  (c) => `The ${c} Toolkit`,
  (c) => `${c} Insider`,
  // "All Things X" rather than "Build With X": the latter reads fine for AI or
  // Tech but not for Fitness or Money, and the templates must suit every niche.
  (c) => `All Things ${c}`,
  (c) => `${c} HQ`,
  (c) => `The ${c} Stack`,
  (c) => `${c} Edge`,
  (c) => `Smart ${c}`,
  (c) => `${c} Lab`,
  (c) => `The Daily ${c}`,
  (c) => `${c} Playbook`,
  (c) => `${c} Weekly`,
  (c) => `Inside ${c}`,
  (c) => `${c} Notes`,
  (c) => `The ${c} Report`,
  (c) => `${c} Signal`,
  (c) => `Everyday ${c}`,
  (c) => `${c} Field Guide`,
];

/**
 * A short, brandable core drawn from a niche name.
 * "Crypto & Web3" -> "Crypto"; "Productivity" -> "Productivity".
 */
export function shortNameFor(nicheName: string): string {
  const cleaned = (nicheName ?? "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "Daily";
  // "X & Y" reads badly inside a template, so keep the leading half.
  const head = cleaned.split(/\s*&\s*/)[0].trim();
  return head || "Daily";
}

/** Small deterministic PRNG (mulberry32) so a seed always gives the same set. */
function rng(seed: number): () => number {
  let a = (seed >>> 0) + 0x6d2b79f5;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function suggestPageNames(opts: {
  nicheName: string;
  /** Overrides the derived core — presets supply a hand-picked one. */
  shortName?: string;
  seed: number;
  count?: number;
}): string[] {
  const core = (opts.shortName?.trim() || shortNameFor(opts.nicheName)).trim() || "Daily";
  const count = opts.count ?? 10;

  // Fisher-Yates over the template list, so a seed selects both which
  // templates appear and their order.
  const pool = [...TEMPLATES];
  const rand = rng(opts.seed);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  const seen = new Set<string>();
  const names: string[] = [];
  for (const template of pool) {
    const name = template(core).replace(/\s+/g, " ").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
    if (names.length === count) break;
  }
  return names;
}
