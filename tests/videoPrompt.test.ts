import { describe, expect, it } from "vitest";
import { buildVideoPrompt, VIDEO_TOOLS, toolUrl } from "../src/domain/videoPrompt.js";

describe("buildVideoPrompt", () => {
  const base = { topic: "AI tools that save you hours", durationSec: 8 };

  it("includes the topic", () => {
    expect(buildVideoPrompt(base)).toContain("AI tools that save you hours");
  });

  it("always demands vertical 9:16 — Reels and Shorts reject anything else", () => {
    expect(buildVideoPrompt(base)).toMatch(/9:16|vertical/i);
  });

  it("states a duration so the tool doesn't return a 2-second loop", () => {
    expect(buildVideoPrompt(base)).toContain("8");
  });

  it("forbids on-screen text, which would collide with our own captions", () => {
    const p = buildVideoPrompt(base);
    expect(p).toMatch(/no on-screen text|no text/i);
    expect(p).toMatch(/watermark/i);
  });

  it("asks for motion — a static shot defeats the point of generating video", () => {
    expect(buildVideoPrompt(base)).toMatch(/motion|camera|move/i);
  });

  it("folds in the niche when given", () => {
    expect(buildVideoPrompt({ ...base, niche: "Personal Finance" })).toContain("Personal Finance");
  });

  it("folds in a scene hint when given", () => {
    expect(buildVideoPrompt({ ...base, sceneHint: "hands typing on a laptop" }))
      .toContain("hands typing on a laptop");
  });

  it("omits empty optional fields rather than leaving dangling separators", () => {
    const p = buildVideoPrompt({ ...base, niche: "   ", sceneHint: "" });
    expect(p).not.toMatch(/\s{2,}/);
    expect(p).not.toMatch(/\.\s*\./);
  });

  it("collapses whitespace in the topic so the prompt stays one clean line", () => {
    expect(buildVideoPrompt({ topic: "a\n\n  b", durationSec: 5 })).toContain("a b");
  });
});

describe("VIDEO_TOOLS", () => {
  it("lists tools with unique ids", () => {
    expect(new Set(VIDEO_TOOLS.map(t => t.id)).size).toBe(VIDEO_TOOLS.length);
  });

  it("leads with the Veo video page, model preselected", () => {
    expect(VIDEO_TOOLS[0]!.id).toBe("veo");
    expect(VIDEO_TOOLS[0]!.url).toContain("veo-3.1");
  });

  it("no longer offers ChatGPT/Sora", () => {
    // Removed on the user's report that the Sora project was discontinued.
    expect(VIDEO_TOOLS.some(t => /sora|chatgpt/i.test(t.id + t.label))).toBe(false);
  });

  it("only claims prefill where the ?q= pattern is actually proven", () => {
    // Gemini's ?q= is the pattern the image bridge already relies on.
    // Everything else copies and opens, which always works.
    expect(VIDEO_TOOLS.filter(t => t.prefill).map(t => t.id)).toEqual(["gemini"]);
  });

  it("gives every tool an https url", () => {
    for (const tool of VIDEO_TOOLS) expect(tool.url).toMatch(/^https:\/\//);
  });
});

describe("toolUrl", () => {
  it("appends the prompt for tools that support prefill", () => {
    const gemini = VIDEO_TOOLS.find(t => t.id === "gemini")!;
    expect(toolUrl(gemini, "make a video")).toContain(encodeURIComponent("make a video"));
  });

  it("returns the bare url for tools without prefill, not a broken query", () => {
    const canva = VIDEO_TOOLS.find(t => t.id === "canva")!;
    expect(toolUrl(canva, "make a video")).toBe(canva.url);
  });

  it("uses & when the url already has a query string", () => {
    // The AI Studio link pins ?model=veo-3.1-…; appending a second "?" would
    // produce a malformed URL and silently drop the model parameter.
    const withQuery = { ...VIDEO_TOOLS[0]!, prefill: true };
    const url = toolUrl(withQuery, "hello");
    expect(url.match(/\?/g)).toHaveLength(1);
    expect(url).toContain("model=veo-3.1");
    expect(url).toContain("&q=hello");
  });

  it("produces a parseable URL in every case", () => {
    for (const tool of VIDEO_TOOLS) {
      expect(() => new URL(toolUrl(tool, "a prompt with spaces & symbols"))).not.toThrow();
    }
  });
});
