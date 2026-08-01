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

  it("drops punctuation-only and emoji-only entries", () => {
    expect(normalizeKeywords(["!!!", "...", "\u{1F600}", "\u{1F525}\u{1F525}", "→"])).toEqual([]);
  });

  it("keeps leading hashes but strips trailing ones (##AI## -> ##ai)", () => {
    // Locked-in current behavior: '#' is allowed at the leading edge (hashtags)
    // but stripped from the trailing edge.
    expect(normalizeKeywords(["##AI##"])).toEqual(["##ai"]);
  });
});

import { normaliseDevToTag } from "../src/services/ingestion/devto.js";

describe("normaliseDevToTag", () => {
  // dev.to tags are lowercase alphanumeric. Passing a niche keyword verbatim
  // produced ?tag=ai%20tools, which 404s — so the source silently returned
  // nothing for any niche whose keywords are more than one word.
  it("collapses a multi-word keyword into a dev.to tag", () => {
    expect(normaliseDevToTag("machine learning")).toBe("machinelearning");
    expect(normaliseDevToTag("AI Tools")).toBe("aitools");
  });

  it("strips punctuation dev.to does not accept", () => {
    expect(normaliseDevToTag("web-dev")).toBe("webdev");
    expect(normaliseDevToTag("node.js")).toBe("nodejs");
  });

  it("returns empty for a keyword with nothing usable, so it can be dropped", () => {
    expect(normaliseDevToTag("!!!")).toBe("");
  });
});
