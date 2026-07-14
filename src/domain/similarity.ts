/** Cosine similarity + normalization for embedding-based relevance.
 *
 *  Bands calibrated empirically against gemini-embedding-001 (3072-dim),
 *  2026-07-14, using dev-niche/topic pairs:
 *    related niche↔topic  ≈ 0.59–0.62
 *    unrelated pairs      ≈ 0.48–0.58  (worst offender: finance↔baking 0.5745)
 *    near-duplicate topics ≈ 0.92
 *  Relevance maps the narrow related/unrelated gap; the near-duplicate band
 *  is separate so merely-adjacent same-niche topics keep their novelty. */

export const COSINE_FLOOR = 0.55;
export const COSINE_CEIL = 0.75;

/** Minimum normalized similarity for a zero-keyword topic to escape the
 *  hard discard (raw cosine ≈0.58 — just above the measured unrelated band). */
export const SEMANTIC_RESCUE_THRESHOLD = 0.15;

/** Near-duplicate band for novelty: only genuinely near-identical topics
 *  (measured near-dupes ≈0.92; adjacent same-niche topics ≈0.6–0.7)
 *  should reduce novelty. */
export const DUPE_FLOOR = 0.75;
export const DUPE_CEIL = 0.95;

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Map a raw cosine onto [0,1] relevance, clamped. Non-finite input
 *  (NaN from a corrupt cached vector) is treated as no-signal → 0. */
export function normalizeCosine(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(1, (raw - COSINE_FLOOR) / (COSINE_CEIL - COSINE_FLOOR)));
}

/** Map a raw cosine onto [0,1] near-duplicate strength for novelty, clamped. */
export function normalizeDupeCosine(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(1, (raw - DUPE_FLOOR) / (DUPE_CEIL - DUPE_FLOOR)));
}
