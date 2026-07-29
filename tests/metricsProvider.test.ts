import { describe, expect, it } from "vitest";
import { selectProvider } from "../src/services/metrics/index.js";

const base = {
  jobId: "j1", pageId: "p1", externalPostId: "abc",
  publishedAt: new Date(), captured: [] as string[],
  contentType: "reel", hook: "h", dryRun: false,
};

describe("selectProvider", () => {
  it("uses real Instagram insights for a live Instagram post", () => {
    expect(selectProvider({ ...base, platform: "instagram" } as any)?.source).toBe("instagram");
  });

  // A live post on a platform with no provider used to fall through to the
  // simulated one, so invented numbers were stored as genuine metrics, shown
  // on Performance as fact, and fed to the learning EMA.
  it("records nothing for a live post it cannot measure", () => {
    expect(selectProvider({ ...base, platform: "facebook" } as any)).toBeNull();
  });

  it("records nothing for Instagram without an external id", () => {
    expect(selectProvider({ ...base, platform: "instagram", externalPostId: null } as any)).toBeNull();
  });

  // Dry runs published nothing, so synthetic numbers misrepresent nothing and
  // demo installs keep a populated view.
  it("still simulates dry runs, on any platform", () => {
    expect(selectProvider({ ...base, platform: "youtube_shorts", dryRun: true } as any)?.source)
      .toBe("simulated");
    expect(selectProvider({ ...base, platform: "instagram", dryRun: true } as any)?.source)
      .toBe("simulated");
  });
});

import { parseVideoStatistics } from "../src/services/metrics/youtubeProvider.js";

describe("parseVideoStatistics", () => {
  it("maps YouTube's statistics block", () => {
    expect(parseVideoStatistics({ viewCount: "1204", likeCount: "88", commentCount: "12" }))
      .toEqual({ views: 1204, reach: 1204, likes: 88, comments: 12, saves: 0, shares: 0, follows: 0 });
  });

  // The Data API omits likeCount entirely when a creator hides likes; that is
  // not zero engagement, but 0 is the only honest number available.
  it("survives hidden like counts", () => {
    const m = parseVideoStatistics({ viewCount: "500", commentCount: "3" });
    expect(m).toMatchObject({ views: 500, likes: 0, comments: 3 });
  });

  // reach mirrors views on purpose: engagementRate divides by reach, and
  // leaving it 0 would score every Short at zero engagement forever.
  it("mirrors views into reach so engagement is computable", () => {
    expect(parseVideoStatistics({ viewCount: "200", likeCount: "10" })?.reach).toBe(200);
  });

  it("returns null for a missing statistics block", () => {
    expect(parseVideoStatistics(undefined)).toBeNull();
    expect(parseVideoStatistics(null)).toBeNull();
  });

  it("treats malformed counts as zero rather than NaN", () => {
    expect(parseVideoStatistics({ viewCount: "abc", likeCount: "-5" }))
      .toMatchObject({ views: 0, likes: 0 });
  });
});

describe("selectProvider with YouTube available", () => {
  it("now measures live Shorts instead of recording nothing", () => {
    expect(selectProvider({ ...base, platform: "youtube_shorts" } as any)?.source).toBe("youtube");
  });

  it("still records nothing for a platform with no provider", () => {
    expect(selectProvider({ ...base, platform: "linkedin" } as any)).toBeNull();
  });
});
