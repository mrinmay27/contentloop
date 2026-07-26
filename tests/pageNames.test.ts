import { describe, expect, it } from "vitest";
import { shortNameFor, suggestPageNames } from "../src/domain/pageNames.js";

describe("shortNameFor", () => {
  it("drops a trailing '& something' clause", () => {
    expect(shortNameFor("Crypto & Web3")).toBe("Crypto");
    expect(shortNameFor("Fitness & Health")).toBe("Fitness");
  });
  it("keeps a single meaningful word as-is", () => {
    expect(shortNameFor("Productivity")).toBe("Productivity");
  });
  it("trims whitespace and collapses inner spacing", () => {
    expect(shortNameFor("  Tech   News  ")).toBe("Tech News");
  });
  it("falls back to a usable word for empty input", () => {
    expect(shortNameFor("")).toBe("Daily");
    expect(shortNameFor("   ")).toBe("Daily");
  });
});

describe("suggestPageNames", () => {
  const opts = { nicheName: "Fitness & Health", seed: 1 };

  it("returns the requested number of names", () => {
    expect(suggestPageNames({ ...opts, count: 10 })).toHaveLength(10);
  });

  it("returns no duplicates", () => {
    const names = suggestPageNames({ ...opts, count: 10 });
    expect(new Set(names).size).toBe(names.length);
  });

  it("actually reflects the niche", () => {
    // The regression: every niche produced the same hardcoded AI names, so
    // picking Fitness offered "AI Tools Daily" and "Build With AI".
    const names = suggestPageNames({ ...opts, count: 10 });
    expect(names.some(n => n.includes("Fitness"))).toBe(true);
    expect(names.every(n => !n.includes("AI"))).toBe(true);
  });

  it("gives different niches different names", () => {
    const fitness = suggestPageNames({ nicheName: "Fitness & Health", seed: 1, count: 10 });
    const crypto  = suggestPageNames({ nicheName: "Crypto & Web3",    seed: 1, count: 10 });
    expect(fitness).not.toEqual(crypto);
  });

  it("is deterministic for a given seed", () => {
    expect(suggestPageNames({ ...opts, count: 10 }))
      .toEqual(suggestPageNames({ ...opts, count: 10 }));
  });

  it("produces a different set for a different seed — this is what Regenerate does", () => {
    const first  = suggestPageNames({ nicheName: "Fitness & Health", seed: 1, count: 10 });
    const second = suggestPageNames({ nicheName: "Fitness & Health", seed: 2, count: 10 });
    expect(first).not.toEqual(second);
  });

  it("prefers an explicit short name when the caller has one", () => {
    const names = suggestPageNames({
      nicheName: "Personal Finance", shortName: "Money", seed: 3, count: 6,
    });
    expect(names.some(n => n.includes("Money"))).toBe(true);
  });

  it("never emits an empty or whitespace-only name", () => {
    for (const seed of [0, 1, 7, 42]) {
      for (const name of suggestPageNames({ nicheName: "Tech News", seed, count: 10 })) {
        expect(name.trim()).not.toBe("");
      }
    }
  });
});
