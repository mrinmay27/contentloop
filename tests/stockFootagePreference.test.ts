import { describe, expect, it } from "vitest";
import { pickBackgroundPlan } from "../src/services/stockFootage.js";

describe("pickBackgroundPlan", () => {
  it("uses video for every slide when enough clips exist", () => {
    expect(pickBackgroundPlan(3, 5, 10)).toEqual(["video", "video", "video"]);
  });

  it("falls back to images for slides beyond the available clips", () => {
    // Mixing is correct: two good clips beat two clips plus a black gap.
    expect(pickBackgroundPlan(4, 2, 10)).toEqual(["video", "video", "image", "image"]);
  });

  it("uses images throughout when no clips are available", () => {
    expect(pickBackgroundPlan(3, 0, 10)).toEqual(["image", "image", "image"]);
  });

  it("returns nothing to source when there is no media at all", () => {
    // Composition falls back to gradient backgrounds, which already works.
    expect(pickBackgroundPlan(3, 0, 0)).toEqual([]);
  });

  it("never plans more slots than slides", () => {
    expect(pickBackgroundPlan(2, 99, 99)).toHaveLength(2);
  });

  it("handles a zero-slide reel without throwing", () => {
    expect(pickBackgroundPlan(0, 5, 5)).toEqual([]);
  });

  it("stops at the last video when images are unavailable", () => {
    // Two clips, no stills: plan two slots, not four with empty tail.
    expect(pickBackgroundPlan(4, 2, 0)).toEqual(["video", "video"]);
  });
});
