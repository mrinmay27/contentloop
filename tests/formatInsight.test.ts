import { describe, expect, it } from "vitest";
import { summariseFormatPerformance } from "../src/domain/formatInsight.js";
import { MIN_FORMAT_SAMPLES } from "../src/domain/learning.js";

const sig = (label: string, score: number, sampleSize: number) => ({ label, score, sampleSize });

describe("summariseFormatPerformance", () => {
  it("reports nothing to show when there are no signals", () => {
    const s = summariseFormatPerformance([]);
    expect(s.status).toBe("none");
    expect(s.leader).toBeNull();
    expect(s.rows).toEqual([]);
  });

  it("ranks formats by score, best first", () => {
    const s = summariseFormatPerformance([
      sig("post", 0.02, 9), sig("carousel", 0.05, 9), sig("reel", 0.03, 9),
    ]);
    expect(s.rows.map(r => r.label)).toEqual(["carousel", "reel", "post"]);
  });

  it("is 'gathering' until the leader has enough samples", () => {
    // Must match the threshold applyLearnedFormat actually uses, or the UI
    // would claim the bias is live while the engine is still ignoring it.
    const s = summariseFormatPerformance([sig("carousel", 0.05, MIN_FORMAT_SAMPLES - 1)]);
    expect(s.status).toBe("gathering");
    expect(s.samplesNeeded).toBe(1);
    expect(s.leader).toBeNull();
  });

  it("is 'active' once the leader clears the threshold", () => {
    const s = summariseFormatPerformance([
      sig("carousel", 0.05, MIN_FORMAT_SAMPLES), sig("post", 0.01, MIN_FORMAT_SAMPLES),
    ]);
    expect(s.status).toBe("active");
    expect(s.leader?.label).toBe("carousel");
    expect(s.samplesNeeded).toBe(0);
  });

  it("picks the best ELIGIBLE format, not the best overall", () => {
    // A format with one lucky sample must not be announced as the winner.
    const s = summariseFormatPerformance([
      sig("reel", 0.99, 1), sig("carousel", 0.05, MIN_FORMAT_SAMPLES),
    ]);
    expect(s.leader?.label).toBe("carousel");
  });

  it("marks which rows are eligible so the UI can distinguish them", () => {
    const s = summariseFormatPerformance([
      sig("reel", 0.99, 1), sig("carousel", 0.05, MIN_FORMAT_SAMPLES),
    ]);
    expect(s.rows.find(r => r.label === "reel")?.eligible).toBe(false);
    expect(s.rows.find(r => r.label === "carousel")?.eligible).toBe(true);
  });

  it("reports the leader's edge over the next format", () => {
    const s = summariseFormatPerformance([
      sig("carousel", 0.06, MIN_FORMAT_SAMPLES), sig("post", 0.03, MIN_FORMAT_SAMPLES),
    ]);
    expect(s.leadMultiple).toBeCloseTo(2, 5);
  });

  it("has no lead multiple when only one format has data", () => {
    const s = summariseFormatPerformance([sig("carousel", 0.06, MIN_FORMAT_SAMPLES)]);
    expect(s.leadMultiple).toBeNull();
  });

  it("ignores non-finite scores rather than ranking them", () => {
    const s = summariseFormatPerformance([
      sig("post", Number.NaN, 9), sig("carousel", 0.04, MIN_FORMAT_SAMPLES),
    ]);
    expect(s.rows.map(r => r.label)).toEqual(["carousel"]);
    expect(s.leader?.label).toBe("carousel");
  });
});
