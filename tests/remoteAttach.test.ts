import { describe, expect, it } from "vitest";
import { kindForFormat, filenameFor } from "../src/domain/remoteAttach.js";

describe("kindForFormat", () => {
  it("treats mp4 as video and png/jpg as image", () => {
    expect(kindForFormat("mp4")).toBe("video");
    expect(kindForFormat("png")).toBe("image");
    expect(kindForFormat("jpg")).toBe("image");
  });
  it("is case and dot tolerant", () => {
    expect(kindForFormat(".MP4")).toBe("video");
    expect(kindForFormat("PNG")).toBe("image");
  });
  it("returns null for things we cannot composite, like pdf", () => {
    // Canva exports PDF too — it is a valid export, just not usable as a
    // slide background, so it must be refused rather than silently stored.
    expect(kindForFormat("pdf")).toBeNull();
    expect(kindForFormat("")).toBeNull();
    expect(kindForFormat(undefined)).toBeNull();
  });
});

describe("filenameFor", () => {
  it("names a whole-reel video predictably", () => {
    expect(filenameFor("video", null)).toBe("source.mp4");
  });
  it("names per-slide video by index so slide N maps to entry N", () => {
    expect(filenameFor("video", 2)).toBe("slide_2.mp4");
  });
  it("names images by index", () => {
    expect(filenameFor("image", 0)).toBe("slide_0.png");
  });
  it("falls back to index 0 for an image with no slide", () => {
    expect(filenameFor("image", null)).toBe("slide_0.png");
  });
});
