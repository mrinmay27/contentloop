import { describe, expect, it } from "vitest";
import { dueCapturePoints } from "../src/services/metrics/capture.js";

const at = (iso: string) => new Date(iso);

describe("dueCapturePoints", () => {
  const published = at("2026-07-10T12:00:00Z");

  it("nothing due immediately after publish", () => {
    expect(dueCapturePoints(published, [], at("2026-07-10T12:30:00Z"))).toEqual([]);
  });

  it("1h due after an hour", () => {
    expect(dueCapturePoints(published, [], at("2026-07-10T13:05:00Z"))).toEqual(["1h"]);
  });

  it("skips already-captured points", () => {
    expect(dueCapturePoints(published, ["1h"], at("2026-07-10T14:00:00Z"))).toEqual([]);
  });

  it("catches up multiple missed points", () => {
    expect(dueCapturePoints(published, [], at("2026-07-12T12:00:00Z"))).toEqual(["1h", "24h"]);
  });

  it("all three due after a week", () => {
    expect(dueCapturePoints(published, [], at("2026-07-17T13:00:00Z"))).toEqual(["1h", "24h", "7d"]);
  });

  it("abandons points past cutoff (7d + 24h)", () => {
    expect(dueCapturePoints(published, [], at("2026-07-19T12:00:00Z"))).toEqual([]);
  });
});
