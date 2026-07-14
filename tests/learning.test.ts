import { describe, expect, it } from "vitest";
import { ema, snapshotSignals, learnedBoost, type LearnedSignals } from "../src/domain/learning.js";

describe("ema", () => {
  it("first observation returns the value itself", () => {
    expect(ema(null, 0.05)).toBe(0.05);
  });
  it("blends with alpha=0.3", () => {
    expect(ema(0.10, 0.20)).toBeCloseTo(0.3 * 0.20 + 0.7 * 0.10, 10);
  });
});

describe("snapshotSignals", () => {
  it("emits one keyword signal per unique lowercased keyword + one format signal", () => {
    const sigs = snapshotSignals(["AI", "ai", "Fintech"], "reel", 0.04);
    expect(sigs).toEqual([
      { signalType: "keyword", label: "ai", engagementRate: 0.04 },
      { signalType: "keyword", label: "fintech", engagementRate: 0.04 },
      { signalType: "format", label: "reel", engagementRate: 0.04 },
    ]);
  });

  it("skips keyword labels longer than 40 chars (legacy sentence keywords)", () => {
    const long = "new updates to ai mode and overviews make it easier to dive deeper";
    const sigs = snapshotSignals([long, "ai"], "post", 0.05);
    expect(sigs).toEqual([
      { signalType: "keyword", label: "ai", engagementRate: 0.05 },
      { signalType: "format", label: "post", engagementRate: 0.05 },
    ]);
  });
});

describe("learnedBoost", () => {
  const learned = (entries: Array<[string, number, number]>, nicheAvg: number): LearnedSignals => ({
    keywordScores: new Map(entries.map(([k, score, sampleSize]) => [k, { score, sampleSize }])),
    nicheAvg,
  });

  it("returns 1.0 with no learned data", () => {
    expect(learnedBoost(["ai"], undefined)).toBe(1.0);
  });

  it("returns 1.0 when no keywords match", () => {
    expect(learnedBoost(["crypto"], learned([["ai", 0.08, 10]], 0.04))).toBe(1.0);
  });

  it("ignores signals with sample_size < 3", () => {
    expect(learnedBoost(["ai"], learned([["ai", 0.08, 2]], 0.04))).toBe(1.0);
  });

  it("boosts above-average keywords, clamped at 1.10", () => {
    // ratio 2.0 → 1 + (2-1)*0.5 = 1.5 → clamped to 1.10
    expect(learnedBoost(["ai"], learned([["ai", 0.08, 5]], 0.04))).toBe(1.10);
  });

  it("penalizes below-average keywords, clamped at 0.90", () => {
    // ratio 0.25 → 1 + (0.25-1)*0.5 = 0.625 → clamped to 0.90
    expect(learnedBoost(["ai"], learned([["ai", 0.01, 5]], 0.04))).toBe(0.90);
  });

  it("average keywords → ~1.0", () => {
    expect(learnedBoost(["ai"], learned([["ai", 0.04, 5]], 0.04))).toBeCloseTo(1.0, 10);
  });

  it("matches case-insensitively", () => {
    expect(learnedBoost(["AI"], learned([["ai", 0.08, 5]], 0.04))).toBe(1.10);
  });

  it("returns 1.0 when nicheAvg is NaN", () => {
    expect(learnedBoost(["ai"], learned([["ai", 0.08, 5]], NaN))).toBe(1.0);
  });

  it("ignores matched entries with NaN score", () => {
    expect(learnedBoost(["ai"], learned([["ai", NaN, 5]], 0.04))).toBe(1.0);
  });

  it("scales mid-range above-average boost without clamping", () => {
    // ratio 1.1 → 1 + 0.1*0.5 = 1.05
    expect(learnedBoost(["ai"], learned([["ai", 0.044, 5]], 0.04))).toBeCloseTo(1.05, 10);
  });

  it("scales mid-range below-average penalty without clamping", () => {
    // ratio 0.9 → 1 + (-0.1)*0.5 = 0.95
    expect(learnedBoost(["ai"], learned([["ai", 0.036, 5]], 0.04))).toBeCloseTo(0.95, 10);
  });

  it("dedupes duplicated topic keywords so they are not double-counted", () => {
    const data = learned([["ai", 0.044, 5], ["crypto", 0.02, 5]], 0.04);
    expect(learnedBoost(["AI", "ai", "crypto"], data)).toBeCloseTo(
      learnedBoost(["ai", "crypto"], data),
      10
    );
  });
});
