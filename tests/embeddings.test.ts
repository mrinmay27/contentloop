import { describe, expect, it } from "vitest";
import {
  FallbackHashEmbedder,
  composeTopicText,
  composeNicheText,
  parseGeminiBatchResponse,
  unitNormalize,
} from "../src/services/embeddings.js";
import { cosineSimilarity } from "../src/domain/similarity.js";

describe("FallbackHashEmbedder", () => {
  const embedder = new FallbackHashEmbedder();

  it("is deterministic and unit-length", async () => {
    const [a] = (await embedder.embedBatch(["ai startups"]))!;
    const [b] = (await embedder.embedBatch(["ai startups"]))!;
    expect(a).toEqual(b);
    const norm = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 6);
  });

  it("related texts score higher than unrelated", async () => {
    const [ai1, ai2, cooking] = (await embedder.embedBatch([
      "ai machine learning startups",
      "machine learning ai companies",
      "sourdough bread baking recipes",
    ]))!;
    expect(cosineSimilarity(ai1, ai2)).toBeGreaterThan(cosineSimilarity(ai1, cooking));
  });
});

describe("text composition", () => {
  it("topic text = title + keywords", () => {
    expect(composeTopicText({ title: "AI rising", keywords: ["ai", "ml"] } as any))
      .toBe("AI rising. ai, ml");
  });
  it("niche text = name + persona + keywords", () => {
    expect(composeNicheText({ name: "Tech", targetPersona: "founders", keywords: ["ai"] } as any))
      .toBe("Tech. founders. ai");
  });
});

describe("parseGeminiBatchResponse", () => {
  it("extracts and unit-normalizes vectors", () => {
    const vecs = parseGeminiBatchResponse({ embeddings: [{ values: [3, 4] }] });
    expect(vecs).toEqual([[0.6, 0.8]]);
  });
  it("returns null on malformed payloads", () => {
    expect(parseGeminiBatchResponse({} as any)).toBeNull();
    expect(parseGeminiBatchResponse({ embeddings: [{}] } as any)).toBeNull();
  });
});

describe("unitNormalize", () => {
  it("zero vector stays zero (no NaN)", () => {
    expect(unitNormalize([0, 0])).toEqual([0, 0]);
  });
});
