import { describe, expect, it } from "vitest";
import { runQualityGate } from "../src/services/qa.js";
import type { GeneratedContent } from "../src/domain/types.js";

function makeContent(overrides: Partial<GeneratedContent> = {}): GeneratedContent {
  return {
    reelScripts: [{
      title: "Budget basics",
      hook: "Five money mistakes that quietly drain your paycheck",
      script: "Track spending weekly. Cut one subscription. Automate savings.",
      cta: "Save this and follow for weekly money tips",
      hookScore: 0.8,
    }],
    carousel: Array.from({ length: 8 }, (_, i) => ({
      slide: i + 1,
      title: `Slide ${i + 1}`,
      body: "Short and clear body text. Try one step today.",
    })),
    captions: { instagram: "Follow for more. Save this post.", youtube_shorts: "Subscribe for more." } as any,
    hashtags: ["#money"],
    ...overrides,
  };
}

describe("runQualityGate — generic checks", () => {
  it("passes well-formed content", () => {
    const result = runQualityGate(makeContent());
    expect(result.passed).toBe(true);
  });

  it("fails hook_clarity for a too-short hook", () => {
    const result = runQualityGate(makeContent({
      reelScripts: [{ title: "x", hook: "Money tips", script: "s", cta: "follow", hookScore: 0.5 }],
    }));
    expect(result.checks.find((c) => c.name === "hook_clarity")!.passed).toBe(false);
    expect(result.passed).toBe(false);
  });

  it("fails non_generic_content on filler phrases", () => {
    const result = runQualityGate(makeContent({
      captions: { instagram: "This ultimate guide is a game changer. Follow!" } as any,
    }));
    expect(result.checks.find((c) => c.name === "non_generic_content")!.passed).toBe(false);
  });

  it("fails cta_presence when no engagement action exists", () => {
    const content = makeContent();
    content.reelScripts[0].cta = "Thanks for watching";
    content.captions = { instagram: "Interesting facts about budgets." } as any;
    content.carousel = content.carousel.map((s) => ({ ...s, body: "Neutral body." }));
    const result = runQualityGate(content);
    expect(result.checks.find((c) => c.name === "cta_presence")!.passed).toBe(false);
  });

  it("fails carousel_structure when not exactly 8 slides", () => {
    const result = runQualityGate(makeContent({ carousel: makeContent().carousel.slice(0, 5) }));
    expect(result.checks.find((c) => c.name === "carousel_structure")!.passed).toBe(false);
  });

  it("fails readability on run-on sentences", () => {
    // NOTE: averageSentenceLength is computed across ALL text (hook/script/cta/
    // carousel/captions) joined together, so a single run-on caption sentence
    // gets diluted by the many short default sentences and never pushes the
    // average past 24. To isolate the check, every other field here is blanked
    // out so the run-on sentence is the only sentence contributing to allText.
    const runOn = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ") + ".";
    const result = runQualityGate(makeContent({
      reelScripts: [{ title: "x", hook: "", script: "", cta: "", hookScore: 0.5 }],
      carousel: Array.from({ length: 8 }, (_, i) => ({ slide: i + 1, title: "", body: "" })),
      captions: { instagram: runOn } as any,
    }));
    expect(result.checks.find((c) => c.name === "readability")!.passed).toBe(false);
  });
});

describe("runQualityGate — niche gates", () => {
  it("health: blocks miracle claims", () => {
    const bad = makeContent();
    bad.reelScripts[0].script = "This miracle routine is 100% effective and guaranteed.";
    const result = runQualityGate(bad, "health");
    expect(result.checks.find((c) => c.name === "health_no_miracle_claims")!.passed).toBe(false);
  });

  it("health: requires a professional hedge", () => {
    const good = makeContent();
    good.reelScripts[0].script = "Research suggests morning walks help. Consult your doctor.";
    expect(runQualityGate(good, "health").checks.find((c) => c.name === "health_professional_hedge")!.passed).toBe(true);

    const noHedge = makeContent(); // fixture has no hedge language
    expect(runQualityGate(noHedge, "health").checks.find((c) => c.name === "health_professional_hedge")!.passed).toBe(false);
  });

  it("finance: blocks guaranteed returns, requires disclaimer", () => {
    const bad = makeContent();
    bad.reelScripts[0].script = "Guaranteed returns with this risk-free investment.";
    const result = runQualityGate(bad, "finance");
    expect(result.checks.find((c) => c.name === "finance_no_guaranteed_returns")!.passed).toBe(false);

    const good = makeContent();
    good.captions = { instagram: "Not financial advice — do your own research. Follow for more." } as any;
    expect(runQualityGate(good, "finance").checks.find((c) => c.name === "finance_not_financial_advice")!.passed).toBe(true);
  });

  it("food: blocks guaranteed allergen-free claims", () => {
    const bad = makeContent();
    bad.reelScripts[0].script = "Guaranteed nut-free brownies everyone can eat.";
    const result = runQualityGate(bad, "food");
    expect(result.checks.find((c) => c.name === "food_allergen_caution")!.passed).toBe(false);
  });

  it("niche checks absent without a category", () => {
    const names = runQualityGate(makeContent()).checks.map((c) => c.name);
    expect(names.some((n) => n.startsWith("health_") || n.startsWith("finance_") || n.startsWith("food_"))).toBe(false);
  });
});
