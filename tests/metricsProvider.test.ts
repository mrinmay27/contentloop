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

  // The important one. A real YouTube upload used to fall through to the
  // simulated provider, so invented numbers were stored as genuine metrics,
  // shown on Performance as fact, and fed to the learning EMA.
  it("records nothing for a live post it cannot measure", () => {
    expect(selectProvider({ ...base, platform: "youtube_shorts" } as any)).toBeNull();
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
