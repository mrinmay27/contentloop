import { describe, expect, it } from "vitest";
import { isTooStaleForRealCapture } from "../src/services/metrics/index.js";

const at = (iso: string) => new Date(iso);

describe("isTooStaleForRealCapture", () => {
  const published = at("2026-07-10T12:00:00Z");
  it("1h point fresh at 90min", () => {
    expect(isTooStaleForRealCapture(published, "1h", at("2026-07-10T13:30:00Z"))).toBe(false);
  });
  it("1h point stale after 2h", () => {
    expect(isTooStaleForRealCapture(published, "1h", at("2026-07-10T14:30:00Z"))).toBe(true);
  });
  it("24h point fresh at 40h, stale at 49h", () => {
    expect(isTooStaleForRealCapture(published, "24h", at("2026-07-12T04:00:00Z"))).toBe(false);
    expect(isTooStaleForRealCapture(published, "24h", at("2026-07-12T13:00:00Z"))).toBe(true);
  });
});
