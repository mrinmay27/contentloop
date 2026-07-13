import { describe, expect, it } from "vitest";
import { parseInsightsResponse } from "../src/services/metrics/instagramProvider.js";

describe("parseInsightsResponse", () => {
  it("maps IG metric names onto MetricSnapshot (saved→saves, views)", () => {
    const snap = parseInsightsResponse([
      { name: "views", values: [{ value: 1200 }] },
      { name: "reach", values: [{ value: 900 }] },
      { name: "likes", values: [{ value: 80 }] },
      { name: "comments", values: [{ value: 5 }] },
      { name: "saved", values: [{ value: 12 }] },
      { name: "shares", values: [{ value: 7 }] },
      { name: "follows", values: [{ value: 3 }] },
    ]);
    expect(snap).toEqual({ views: 1200, reach: 900, likes: 80, comments: 5, saves: 12, shares: 7, follows: 3 });
  });

  it("maps impressions→views on fallback responses; missing metrics → 0", () => {
    const snap = parseInsightsResponse([
      { name: "impressions", values: [{ value: 500 }] },
      { name: "reach", values: [{ value: 400 }] },
    ]);
    expect(snap.views).toBe(500);
    expect(snap.likes).toBe(0);
    expect(snap.follows).toBe(0);
  });
});
