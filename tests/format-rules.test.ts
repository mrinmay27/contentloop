import { describe, expect, it } from "vitest";
import { applyLearnedFormat } from "../src/domain/format-rules.js";

const signals = (entries: Array<[string, number, number]>) =>
  entries.map(([label, score, sampleSize]) => ({ label, score, sampleSize }));

describe("applyLearnedFormat", () => {
  it("never overrides user or llm decisions", () => {
    const s = signals([["reel", 0.09, 10]]);
    expect(applyLearnedFormat("post", "user", s)).toEqual({ format: "post", confidence: "user" });
    expect(applyLearnedFormat("post", "llm", s)).toEqual({ format: "post", confidence: "llm" });
  });

  it("overrides weak (rule/page_default) decisions with the learned winner", () => {
    const s = signals([["reel", 0.09, 6], ["post", 0.02, 8]]);
    expect(applyLearnedFormat("post", "rule", s)).toEqual({ format: "reel", confidence: "learned" });
    expect(applyLearnedFormat("post", "page_default", s)).toEqual({ format: "reel", confidence: "learned" });
  });

  it("requires sample_size >= 5 on the winner", () => {
    const s = signals([["reel", 0.09, 4]]);
    expect(applyLearnedFormat("post", "rule", s)).toEqual({ format: "post", confidence: "rule" });
  });

  it("keeps original confidence when learned winner matches current format", () => {
    const s = signals([["post", 0.09, 8]]);
    expect(applyLearnedFormat("post", "rule", s)).toEqual({ format: "post", confidence: "rule" });
  });

  it("no signals → unchanged", () => {
    expect(applyLearnedFormat("carousel", "rule", [])).toEqual({ format: "carousel", confidence: "rule" });
  });
});
