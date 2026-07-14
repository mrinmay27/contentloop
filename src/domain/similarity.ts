/** Cosine similarity + normalization for embedding-based relevance.
 *  Gemini text-embedding-004 cosines: unrelated text ≈0.4–0.55,
 *  strongly related ≈0.75+. Mapped to [0,1] for scoring. */

export const COSINE_FLOOR = 0.5;
export const COSINE_CEIL = 0.85;

/** Minimum normalized similarity for a zero-keyword topic to escape the
 *  hard discard (raw cosine ≈0.55 — just above the unrelated-text band). */
export const SEMANTIC_RESCUE_THRESHOLD = 0.15;

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
