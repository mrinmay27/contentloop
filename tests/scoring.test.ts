import { describe, expect, it } from "vitest";
import { scoreHook, scoreTopic } from "../src/domain/scoring.js";
import type { Niche, Topic } from "../src/domain/types.js";
import type { LearnedSignals } from "../src/domain/learning.js";

const niche: Niche = {
  id: "n1",
  name: "AI Productivity",
  keywords: ["ai", "automation", "workflow", "productivity"],
  monetizationKeywords: ["template", "tool", "workflow"],
  negativeKeywords: [],
  targetPersona: "operators"
};

it("selects high-quality recent cross-source topics", () => {
  const topic: Topic = {
    id: "t1",
    nicheId: "n1",
    title: "AI workflow template saves teams 5 hours",
    keywords: ["ai", "workflow", "template"],
    sources: ["reddit", "rss", "twitter", "google_trends"],
    sourceCount: 4,
    firstSeenAt: new Date(),
    lastSeenAt: new Date(),
    velocity: 0.95,
    score: null,
    decision: null,
    state: "IDEA"
  };

  const scored = scoreTopic(topic, niche, []);

  expect(scored.score).toBeGreaterThanOrEqual(0.75);
  expect(scored.decision).toBe("selected");
});

it("scores specific curiosity hooks higher than vague hooks", () => {
  const strong = scoreHook("Stop wasting 5 hours on this AI workflow mistake");
  const weak = scoreHook("This is a great thing for everyone");

  expect(strong.score).toBeGreaterThan(weak.score);
  expect(strong.score).toBeGreaterThanOrEqual(0.75);
});

// ── Sprint A: learned boost integration ──────────────────────────────────────
describe("scoreTopic learned boost", () => {
  const niche = {
    id: "n1", name: "Tech", keywords: ["ai", "startups"],
    monetizationKeywords: ["saas"], negativeKeywords: [], targetPersona: "founders",
  } as any;
  const topic = {
    id: "t1", nicheId: "n1", title: "AI startups raising in 2026",
    keywords: ["ai", "startups"], sources: ["hackernews"], sourceCount: 2,
    firstSeenAt: new Date(), lastSeenAt: new Date(), velocity: 0.5,
    score: null, decision: null, state: "IDEA",
    suggestedFormat: null, formatConfidence: null,
  } as any;

  const learned: LearnedSignals = {
    keywordScores: new Map([["ai", { score: 0.09, sampleSize: 5 }]]),
    nicheAvg: 0.03,
  };

  it("applies the boost and records it in the breakdown", () => {
    const base = scoreTopic(topic, niche, []);
    const boosted = scoreTopic(topic, niche, [], learned);
    expect(boosted.learnedBoost).toBe(1.10);
    // Precision 5, not 10: scoreTopic's recency term reads Date.now() at call
    // time, so the two calls drift apart by ~1e-9 per elapsed ms and flake tighter bounds.
    expect(boosted.score).toBeCloseTo(Math.min(1, base.score * 1.10), 5);
  });

  it("learnedBoost is 1.0 when no learned data passed", () => {
    expect(scoreTopic(topic, niche, []).learnedBoost).toBe(1.0);
  });
});

// ── Sprint B: semantic blend ─────────────────────────────────────────────────
describe("scoreTopic semantic blend", () => {
  const niche = {
    id: "n1", name: "Tech", keywords: ["ai", "startups"],
    monetizationKeywords: ["saas"], negativeKeywords: [], targetPersona: "founders",
  } as any;

  // NOTE: fixture must avoid "ai"/"startups" even as SUBSTRINGS (the keyword
  // matcher is substring-based — e.g. "raising" contains "ai").
  const paraphrased = {
    id: "t2", nicheId: "n1", title: "Machine intelligence firms secure new funding",
    keywords: ["machine intelligence", "funding"], sources: ["hackernews"], sourceCount: 2,
    firstSeenAt: new Date(), lastSeenAt: new Date(), velocity: 0.5,
    score: null, decision: null, state: "IDEA",
    suggestedFormat: null, formatConfidence: null,
  } as any;

  it("rescues zero-keyword-overlap topics with high semantic similarity", () => {
    const withoutSemantic = scoreTopic(paraphrased, niche, []);
    expect(withoutSemantic.decision).toBe("discarded"); // today's behavior

    const withSemantic = scoreTopic(paraphrased, niche, [], undefined, {
      nicheSimilarity: 0.82, maxRecentSimilarity: 0.3,
    });
    expect(withSemantic.decision).not.toBe("discarded");
    expect(withSemantic.semanticRelevance).toBeGreaterThan(0.8);
  });

  it("still discards when both keyword overlap and similarity are low", () => {
    const result = scoreTopic(paraphrased, niche, [], undefined, {
      nicheSimilarity: 0.45, maxRecentSimilarity: 0.3,
    });
    expect(result.decision).toBe("discarded");
  });

  it("never lowers audienceRelevance for keyword-matching topics (blend is max)", () => {
    const matching = { ...paraphrased, id: "t3", title: "AI startups on the rise", keywords: ["ai", "startups"] };
    const base = scoreTopic(matching, niche, []);
    const blended = scoreTopic(matching, niche, [], undefined, {
      nicheSimilarity: 0.4, maxRecentSimilarity: 0.0, // low semantic must not hurt
    });
    expect(blended.audienceRelevance).toBeGreaterThanOrEqual(base.audienceRelevance);
    expect(blended.score).toBeGreaterThanOrEqual(base.score * 0.999); // no meaningful drop
  });

  it("semantic recent-similarity reduces novelty (paraphrase dedup)", () => {
    const matching = { ...paraphrased, id: "t4", title: "AI startups on the rise", keywords: ["ai", "startups"] };
    const fresh = scoreTopic(matching, niche, [], undefined, {
      nicheSimilarity: 0.8, maxRecentSimilarity: 0.5,
    });
    const dupe = scoreTopic(matching, niche, [], undefined, {
      nicheSimilarity: 0.8, maxRecentSimilarity: 0.85,
    });
    expect(dupe.novelty).toBeLessThan(fresh.novelty);
  });

  it("semanticRelevance is 0 and behavior unchanged when semantic omitted", () => {
    const matching = { ...paraphrased, id: "t5", title: "AI startups on the rise", keywords: ["ai", "startups"] };
    const r = scoreTopic(matching, niche, []);
    expect(r.semanticRelevance).toBe(0);
  });
});
