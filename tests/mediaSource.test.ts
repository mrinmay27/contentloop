import { describe, expect, it } from "vitest";
import {
  resolveAvailability, classifyAspect, isPublishableVertical,
  type MediaSourceDef,
} from "../src/domain/mediaSource.js";

const def = (over: Partial<MediaSourceDef> = {}): MediaSourceDef => ({
  id: "pexels_video", name: "Pexels Video", icon: "🎬", kind: "video",
  docsUrl: "https://www.pexels.com/api/", ...over,
});

describe("resolveAvailability", () => {
  it("is available when the source needs no key", () => {
    expect(resolveAvailability(def({ keyName: undefined }), {})).toBe("available");
  });
  it("is available when the required key is present and non-empty", () => {
    expect(resolveAvailability(def({ keyName: "PEXELS_API_KEY" }),
      { PEXELS_API_KEY: "abc" })).toBe("available");
  });
  it("reports needs_key rather than failing when the key is missing", () => {
    // The whole point: a missing key is a Connect affordance, never a dead end.
    expect(resolveAvailability(def({ keyName: "PEXELS_API_KEY" }), {})).toBe("needs_key");
  });
  it("treats an empty or whitespace key as missing", () => {
    expect(resolveAvailability(def({ keyName: "K" }), { K: "" })).toBe("needs_key");
    expect(resolveAvailability(def({ keyName: "K" }), { K: "   " })).toBe("needs_key");
  });
  it("reports unsupported when the source is explicitly disabled", () => {
    expect(resolveAvailability(def({ supported: false }), {})).toBe("unsupported");
  });
});

describe("classifyAspect", () => {
  it("classifies the three shapes we publish", () => {
    expect(classifyAspect(1080, 1920)).toBe("portrait");
    expect(classifyAspect(1920, 1080)).toBe("landscape");
    expect(classifyAspect(1080, 1080)).toBe("square");
  });
  it("tolerates near-square and near-9:16 rather than demanding exact ratios", () => {
    expect(classifyAspect(1080, 1084)).toBe("square");
    expect(classifyAspect(1078, 1920)).toBe("portrait");
  });
  it("returns null for nonsense dimensions instead of guessing", () => {
    expect(classifyAspect(0, 100)).toBeNull();
    expect(classifyAspect(100, 0)).toBeNull();
    expect(classifyAspect(-5, 10)).toBeNull();
  });
});

describe("isPublishableVertical", () => {
  it("accepts portrait", () => {
    expect(isPublishableVertical(1080, 1920)).toBe(true);
  });
  it("rejects landscape and square — Reels and Shorts need 9:16", () => {
    expect(isPublishableVertical(1920, 1080)).toBe(false);
    expect(isPublishableVertical(1080, 1080)).toBe(false);
  });
});
