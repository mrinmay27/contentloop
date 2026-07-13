import { describe, expect, it } from "vitest";
import { SimulatedMetricsProvider } from "../src/services/metrics/simulatedProvider.js";
import { engagementRate, type PublishedJobContext } from "../src/services/metrics/types.js";

const job = (overrides: Partial<PublishedJobContext> = {}): PublishedJobContext => ({
  jobId: "11111111-1111-1111-1111-111111111111",
  pageId: "p1",
  platform: "instagram",
  externalPostId: null,
  publishedAt: new Date("2026-07-10T18:00:00Z"),
  dryRun: true,
  contentType: "reel",
  hook: "5 mistakes that are costing you followers",
  ...overrides,
});

describe("SimulatedMetricsProvider", () => {
  const provider = new SimulatedMetricsProvider();

  it("is deterministic: same job + point → identical snapshot", async () => {
    const a = await provider.fetchMetrics(job(), "24h");
    const b = await provider.fetchMetrics(job(), "24h");
    expect(a).toEqual(b);
  });

  it("different jobs produce different snapshots", async () => {
    const a = await provider.fetchMetrics(job(), "24h");
    const b = await provider.fetchMetrics(job({ jobId: "22222222-2222-2222-2222-222222222222" }), "24h");
    expect(a).not.toEqual(b);
  });

  it("grows across capture points: 1h < 24h < 7d reach", async () => {
    const h1 = await provider.fetchMetrics(job(), "1h");
    const h24 = await provider.fetchMetrics(job(), "24h");
    const d7 = await provider.fetchMetrics(job(), "7d");
    expect(h1!.reach).toBeLessThan(h24!.reach);
    expect(h24!.reach).toBeLessThan(d7!.reach);
  });

  it("produces sane engagement rates (0.5%–15%)", async () => {
    const snap = await provider.fetchMetrics(job(), "24h");
    const er = engagementRate(snap!);
    expect(er).toBeGreaterThan(0.005);
    expect(er).toBeLessThan(0.15);
  });

  it("interaction parts sum to <= reach and are non-negative", async () => {
    const s = (await provider.fetchMetrics(job(), "24h"))!;
    for (const v of Object.values(s)) expect(v).toBeGreaterThanOrEqual(0);
    expect(s.likes + s.comments + s.saves + s.shares).toBeLessThanOrEqual(s.reach);
  });
});
