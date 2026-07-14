import { describe, expect, it } from "vitest";
import {
  cosineSimilarity, normalizeCosine, normalizeDupeCosine,
  COSINE_FLOOR, COSINE_CEIL, DUPE_FLOOR, DUPE_CEIL, SEMANTIC_RESCUE_THRESHOLD,
} from "../src/domain/similarity.js";

describe("cosineSimilarity", () => {
  it("identical unit vectors → 1", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 6);
  });
  it("orthogonal vectors → 0", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });
  it("empty or length-mismatched inputs → 0", () => {
    expect(cosineSimilarity([], [1])).toBe(0);
    expect(cosineSimilarity([1, 2], [1])).toBe(0);
  });
  it("handles non-normalized inputs", () => {
    expect(cosineSimilarity([3, 0], [7, 0])).toBeCloseTo(1, 6);
  });
});

describe("normalizeCosine", () => {
  it("maps floor→0 and ceil→1, clamped", () => {
    expect(normalizeCosine(COSINE_FLOOR)).toBe(0);
    expect(normalizeCosine(COSINE_CEIL)).toBe(1);
    expect(normalizeCosine(0.2)).toBe(0);
    expect(normalizeCosine(0.99)).toBe(1);
  });
  it("maps midpoint linearly", () => {
    const mid = (COSINE_FLOOR + COSINE_CEIL) / 2;
    expect(normalizeCosine(mid)).toBeCloseTo(0.5, 6);
  });
  it("non-finite input (corrupt cached vector) → 0, never NaN", () => {
    expect(normalizeCosine(NaN)).toBe(0);
    expect(normalizeCosine(Infinity)).toBe(0);
    expect(normalizeCosine(-Infinity)).toBe(0);
  });

  // Calibration lock-in (gemini-embedding-001, measured 2026-07-14):
  // the worst measured UNRELATED pair must stay below the rescue threshold,
  // and the weakest measured RELATED pair must stay above it.
  it("measured unrelated band cannot trigger a rescue; related band can", () => {
    expect(normalizeCosine(0.5745)).toBeLessThan(SEMANTIC_RESCUE_THRESHOLD);   // finance↔baking
    expect(normalizeCosine(0.5924)).toBeGreaterThan(SEMANTIC_RESCUE_THRESHOLD); // weakest related
  });
});

describe("normalizeDupeCosine", () => {
  it("maps dupe floor→0 and ceil→1, clamped", () => {
    expect(normalizeDupeCosine(DUPE_FLOOR)).toBe(0);
    expect(normalizeDupeCosine(DUPE_CEIL)).toBe(1);
    expect(normalizeDupeCosine(0.99)).toBe(1);
  });
  it("adjacent same-niche topics (raw ≈0.65) do not count as duplicates", () => {
    expect(normalizeDupeCosine(0.65)).toBe(0);
  });
  it("measured near-dupe (raw 0.9249) registers strongly", () => {
    expect(normalizeDupeCosine(0.9249)).toBeCloseTo((0.9249 - DUPE_FLOOR) / (DUPE_CEIL - DUPE_FLOOR), 6);
    expect(normalizeDupeCosine(0.9249)).toBeGreaterThan(0.8);
  });
  it("non-finite input → 0", () => {
    expect(normalizeDupeCosine(NaN)).toBe(0);
  });
});
