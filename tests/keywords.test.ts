import { describe, expect, it } from "vitest";
import { normalizeKeywords, MAX_KEYWORD_CHARS, MAX_KEYWORDS } from "../src/domain/keywords.js";

describe("normalizeKeywords", () => {
  it("lowercases, trims, and strips edge punctuation", () => {
    expect(normalizeKeywords(["  AI, ", "«Fintech»", "web3!"])).toEqual(["ai", "fintech", "web3"]);
  });

  it("drops sentence-length entries (>40 chars or >4 words)", () => {
    expect(normalizeKeywords([
      "new updates to ai mode make it easier to dive deeper online",
      "one two three four five",
      "machine learning",
    ])).toEqual(["machine learning"]);
  });

  it("dedupes case-insensitively preserving first occurrence order", () => {
    expect(normalizeKeywords(["AI", "ai", "SaaS", "saas"])).toEqual(["ai", "saas"]);
  });

  it("caps at MAX_KEYWORDS", () => {
    const many = Array.from({ length: 15 }, (_, i) => `kw${i}`);
    expect(normalizeKeywords(many)).toHaveLength(MAX_KEYWORDS);
  });

  it("drops empties and collapses inner whitespace", () => {
    expect(normalizeKeywords(["", "  ", "personal   finance"])).toEqual(["personal finance"]);
  });

  it("exports sane constants", () => {
    expect(MAX_KEYWORD_CHARS).toBe(40);
  });
});
