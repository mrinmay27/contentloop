/** Task 2.5.6 — Niche-aware QA gates.
 *  Generic checks remain for all niches.
 *  Category-specific checks added for health, finance, food.
 */

import type { GeneratedContent, QaResult } from "../domain/types.js";
import type { NicheCategory } from "../domain/niche-taxonomy.js";

export function runQualityGate(content: GeneratedContent, nicheCategory?: NicheCategory): QaResult {
  const hooks = content.reelScripts.map((script) => script.hook);
  const allText = [
    ...content.reelScripts.flatMap((script) => [script.hook, script.script, script.cta]),
    ...content.carousel.flatMap((slide) => [slide.title, slide.body]),
    ...Object.values(content.captions)
  ].join(" ");

  const checks = [
    // ── Generic checks (all niches) ──────────────────────────────────────
    {
      name: "hook_clarity",
      passed: hooks.every((hook) => hook.split(/\s+/).length >= 5 && hook.split(/\s+/).length <= 18),
      reason: "Hooks should be direct and short enough for Reel retention."
    },
    {
      name: "non_generic_content",
      passed: !/unlock your potential|game changer|revolutionary|ultimate guide/i.test(allText),
      reason: "Rejects generic creator filler that weakens trust."
    },
    {
      name: "readability",
      passed: averageSentenceLength(allText) <= 24,
      reason: "Shorter sentences perform better in captions and on-screen slides."
    },
    {
      name: "cta_presence",
      passed: /follow|save|comment|share|dm|subscribe|try|checklist|download/i.test(allText),
      reason: "Every item needs a clear engagement or conversion action."
    },
    {
      name: "carousel_structure",
      passed: content.carousel.length === 8 && content.carousel[0].slide === 1 && content.carousel[7].slide === 8,
      reason: "Carousel must contain hook, value, summary, and CTA slides."
    },

    // ── Category-specific checks ─────────────────────────────────────────

    // Health: block dangerous claim patterns, require hedge language
    ...(nicheCategory === "health" ? [
      {
        name: "health_no_miracle_claims",
        passed: !/\bcure\b|\bguaranteed\b|doctors hate|miracle|100% effective/i.test(allText),
        reason: "Health content must not make guaranteed cure or miracle claims."
      },
      {
        name: "health_professional_hedge",
        passed: /consult|professional|research suggests|studies show|evidence|doctor|physician|nutritionist/i.test(allText),
        reason: "Health content must include a professional disclaimer or research hedge."
      },
    ] : []),

    // Finance: block guaranteed returns language, flag crypto for disclaimer
    ...(nicheCategory === "finance" ? [
      {
        name: "finance_no_guaranteed_returns",
        passed: !/guaranteed returns|can't lose|can not lose|risk.?free investment|sure thing/i.test(allText),
        reason: "Finance content must not promise guaranteed investment returns."
      },
      {
        name: "finance_not_financial_advice",
        passed: /not financial advice|for educational|for informational|consult|do your own research|dyor/i.test(allText),
        reason: "Finance/crypto content must include a disclaimer."
      },
    ] : []),

    // Food: flag allergen-adjacent unqualified claims
    ...(nicheCategory === "food" ? [
      {
        name: "food_allergen_caution",
        passed: !(/\bguaranteed\b/i.test(allText) && /nut.?free|dairy.?free|gluten.?free|allergen/i.test(allText)),
        reason: "Allergen-free claims should not be stated as guaranteed."
      },
    ] : []),
  ];

  return {
    passed: checks.every((check) => check.passed),
    checks
  };
}

function averageSentenceLength(text: string): number {
  const sentences = text.split(/[.!?]+/).map((sentence) => sentence.trim()).filter(Boolean);
  if (sentences.length === 0) return 0;
  const words = sentences.reduce((count, sentence) => count + sentence.split(/\s+/).filter(Boolean).length, 0);
  return words / sentences.length;
}
