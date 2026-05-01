import { expect, it } from "vitest";
import { scoreHook, scoreTopic } from "../src/domain/scoring.js";
import type { Niche, Topic } from "../src/domain/types.js";

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
