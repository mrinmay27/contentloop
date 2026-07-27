import { describe, expect, it } from "vitest";
import { REEL_PATHS, resolveReelPath, rendererFor } from "../src/domain/reelPath.js";

describe("resolveReelPath", () => {
  it("defaults to slideshow when nothing is stored", () => {
    expect(resolveReelPath(undefined)).toBe("slideshow");
    expect(resolveReelPath({})).toBe("slideshow");
  });
  it("honours a stored choice", () => {
    expect(resolveReelPath({ reelPath: "upload" })).toBe("upload");
  });
  it("infers upload when a source video exists but no choice was stored", () => {
    // Content created before this field existed must not be mis-rendered.
    expect(resolveReelPath({ videoUrl: "/media/x/source.mp4" })).toBe("upload");
  });
  it("a stored choice beats inference", () => {
    expect(resolveReelPath({ reelPath: "slideshow", videoUrl: "/media/x/source.mp4" }))
      .toBe("slideshow");
  });
  it("ignores an unknown stored value rather than trusting it", () => {
    expect(resolveReelPath({ reelPath: "nonsense" as any })).toBe("slideshow");
  });
});

describe("rendererFor", () => {
  it("routes the upload path to the captioned renderer", () => {
    expect(rendererFor("upload")).toBe("captioned");
  });
  it("routes slideshow and ai paths to the slide renderer", () => {
    // 'ai' clips arrive through the same upload endpoint, so they render as
    // a captioned video too.
    expect(rendererFor("slideshow")).toBe("slides");
    expect(rendererFor("ai")).toBe("captioned");
  });
});

describe("REEL_PATHS", () => {
  it("describes every path with a label and blurb for the chooser", () => {
    expect(REEL_PATHS).toHaveLength(3);
    for (const p of REEL_PATHS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.blurb.length).toBeGreaterThan(0);
    }
  });
  it("has unique ids matching the resolver", () => {
    expect(REEL_PATHS.map(p => p.id).sort()).toEqual(["ai", "slideshow", "upload"]);
  });
});
