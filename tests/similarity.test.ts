import { describe, expect, it } from "vitest";
import { cosineSimilarity, normalizeCosine, COSINE_FLOOR, COSINE_CEIL } from "../src/domain/similarity.js";

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
});
