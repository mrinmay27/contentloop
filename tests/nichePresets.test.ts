import { describe, expect, it } from "vitest";
import { NICHE_PRESETS, findNichePreset } from "../src/domain/nichePresets.js";

describe("NICHE_PRESETS", () => {
  it("ships the twelve built-in niches the wizard offers", () => {
    expect(NICHE_PRESETS).toHaveLength(12);
  });

  it("gives every preset a unique id and a unique name", () => {
    // Names must be unique because niches.name carries a UNIQUE constraint —
    // two presets sharing one would make the second unreachable.
    expect(new Set(NICHE_PRESETS.map(p => p.id)).size).toBe(NICHE_PRESETS.length);
    expect(new Set(NICHE_PRESETS.map(p => p.name)).size).toBe(NICHE_PRESETS.length);
  });

  it("satisfies what POST /api/niches requires", () => {
    // The route enforces keywords >= 2 and a non-empty persona. A preset that
    // violates this would 400 at the exact moment a new user creates their
    // first page — the worst possible time to discover it.
    for (const preset of NICHE_PRESETS) {
      expect(preset.keywords.length, `${preset.name} keywords`).toBeGreaterThanOrEqual(2);
      expect(preset.monetizationKeywords.length, `${preset.name} monetization`).toBeGreaterThanOrEqual(1);
      expect(preset.targetPersona.trim(), `${preset.name} persona`).not.toBe("");
    }
  });

  it("has no duplicate keywords within a preset", () => {
    for (const preset of NICHE_PRESETS) {
      expect(new Set(preset.keywords).size, `${preset.name}`).toBe(preset.keywords.length);
    }
  });

  it("keeps display metadata the wizard renders", () => {
    for (const preset of NICHE_PRESETS) {
      expect(preset.emoji.length).toBeGreaterThan(0);
      expect(preset.trendScore).toBeGreaterThan(0);
      expect(preset.monetizationScore).toBeGreaterThan(0);
    }
  });
});

describe("findNichePreset", () => {
  it("finds a preset by id", () => {
    expect(findNichePreset("n1")?.name).toBe("AI Tools");
  });
  it("returns undefined for unknown ids rather than throwing", () => {
    expect(findNichePreset("__custom__")).toBeUndefined();
    expect(findNichePreset("")).toBeUndefined();
  });
});
