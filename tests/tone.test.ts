import { describe, expect, it } from "vitest";
import { CAPTION_TONES, DEFAULT_TONE, isCaptionTone, tonePromptFor } from "../src/domain/tone.js";

describe("CAPTION_TONES", () => {
  it("exposes the four tones the create-page wizard offers", () => {
    expect(CAPTION_TONES.map(t => t.id)).toEqual([
      "educational", "bold", "casual", "professional",
    ]);
  });

  it("gives every tone a human label for the UI", () => {
    for (const tone of CAPTION_TONES) {
      expect(tone.label.length).toBeGreaterThan(0);
    }
  });
});

describe("tonePromptFor", () => {
  it("returns a distinct instruction per tone", () => {
    const prompts = CAPTION_TONES.map(t => tonePromptFor(t.id));
    expect(new Set(prompts).size).toBe(CAPTION_TONES.length);
  });

  it("falls back to the default tone for unset or unknown values", () => {
    const fallback = tonePromptFor(DEFAULT_TONE);
    expect(tonePromptFor(undefined)).toBe(fallback);
    expect(tonePromptFor("nonsense")).toBe(fallback);
    expect(tonePromptFor("")).toBe(fallback);
  });

  it("keeps the pre-existing default wording for educational", () => {
    // This was the hardcoded prompt string before tone was configurable —
    // preserved so existing pages generate exactly as they did before.
    expect(tonePromptFor("educational")).toBe("clear, useful, specific, not spammy");
  });
});

describe("isCaptionTone", () => {
  it("accepts known ids and rejects anything else", () => {
    expect(isCaptionTone("casual")).toBe(true);
    expect(isCaptionTone("Educational")).toBe(false); // ids are lowercase
    expect(isCaptionTone(undefined)).toBe(false);
    expect(isCaptionTone(42)).toBe(false);
  });
});
