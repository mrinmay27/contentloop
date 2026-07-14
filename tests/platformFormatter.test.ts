import { describe, expect, it } from "vitest";
import { formatCaption } from "../src/services/platformFormatter.js";

const base = {
  hook: "Five money mistakes draining your paycheck",
  caption: "Track spending weekly and automate savings to build momentum.",
  hashtags: ["money", "#budget", "finance", "savings"],
};

describe("formatCaption", () => {
  it("instagram: hook + caption + hashtags with # prefixes", () => {
    const out = formatCaption({ platform: "instagram", ...base });
    expect(out).toContain(base.hook);
    expect(out).toContain(base.caption);
    expect(out).toContain("#money");
    expect(out).toContain("#budget");
    expect(out).not.toContain("##");
  });

  it("twitter: fits 280 chars and caps hashtags at 2", () => {
    const out = formatCaption({ platform: "twitter", ...base });
    expect(out.length).toBeLessThanOrEqual(280);
    expect(out.match(/#/g)!.length).toBeLessThanOrEqual(2);
    expect(out).not.toContain(base.caption);
  });

  it("twitter: truncates an over-long hook with ellipsis", () => {
    const out = formatCaption({ platform: "twitter", hook: "x".repeat(400), caption: "", hashtags: ["a"] });
    expect(out.length).toBeLessThanOrEqual(280);
    expect(out).toContain("…");
  });

  it("reddit: returns the caption body only", () => {
    const out = formatCaption({ platform: "reddit", ...base });
    expect(out).toBe(base.caption);
  });

  it("youtube_shorts: uses the default hook+caption+tags path", () => {
    const out = formatCaption({ platform: "youtube_shorts", ...base });
    expect(out).toContain(base.hook);
    expect(out).toContain(base.caption);
  });

  it("linkedin: caps hashtags at 5", () => {
    const tags = Array.from({ length: 10 }, (_, i) => `tag${i}`);
    const out = formatCaption({ platform: "linkedin", ...base, hashtags: tags });
    expect(out.match(/#/g)!.length).toBeLessThanOrEqual(5);
  });

  it("trims caption to fit the platform limit", () => {
    // NOTE: the twitter branch never reads `caption` at all (it only formats
    // hook + up to 2 hashtags), so this fixture doesn't exercise caption
    // trimming — it only verifies the 280-char ceiling still holds when a
    // huge caption is supplied. See platformFormatter.ts: the twitter branch
    // builds `full` from `base` (the hook) and `suffix` (hashtags) only.
    const out = formatCaption({ platform: "twitter", hook: "Short hook here for the test", caption: "y".repeat(5000), hashtags: [] });
    expect(out.length).toBeLessThanOrEqual(280);
  });

  it("default path trims an over-long caption with ellipsis (real trim branch)", () => {
    // Exercises the overhead/bodyLimit/trimmedCaption logic that the twitter
    // test above cannot reach (twitter ignores caption entirely).
    const out = formatCaption({ platform: "instagram", ...base, caption: "y".repeat(3000) });
    expect(out.length).toBeLessThanOrEqual(2200);
    expect(out).toContain("…");
    expect(out).toContain(base.hook);
  });

  it("empty hashtags produce no dangling separator", () => {
    const out = formatCaption({ platform: "instagram", ...base, hashtags: [] });
    expect(out.trimEnd()).toBe(out);
    expect(out).not.toMatch(/\n\s*$/);
  });
});
