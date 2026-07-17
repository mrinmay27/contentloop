import { describe, expect, it } from "vitest";
import { validateSourcePatch } from "../src/services/ingestion/sourceMapValidation.js";

describe("validateSourcePatch", () => {
  it("accepts toggles and string arrays", () => {
    const r = validateSourcePatch({
      sourceEnabled: { reddit: false },
      redditSubreddits: ["MachineLearning", " ChatGPT "],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.patch.redditSubreddits).toEqual(["MachineLearning", "ChatGPT"]);
  });

  it("rejects invalid feed URLs", () => {
    const r = validateSourcePatch({ rssFeeds: [{ name: "x", url: "not-a-url" }] });
    expect(r.ok).toBe(false);
  });

  it("accepts valid feeds and plain-string feed arrays (financeFeeds)", () => {
    const r = validateSourcePatch({
      rssFeeds: [{ name: "Blog", url: "https://example.com/feed.xml" }],
      financeFeeds: ["https://example.com/biz.xml"],
    });
    expect(r.ok).toBe(true);
  });

  it("strips unknown keys", () => {
    const r = validateSourcePatch({ evil: "x", sourceEnabled: {} } as any);
    expect(r.ok).toBe(true);
    if (r.ok) expect("evil" in r.patch).toBe(false);
  });

  it("drops empty strings and dedupes", () => {
    const r = validateSourcePatch({ mediumTags: ["ai", "", "ai", "  "] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.patch.mediumTags).toEqual(["ai"]);
  });
});
