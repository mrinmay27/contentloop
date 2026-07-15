import { describe, expect, it } from "vitest";
import {
  isOverperforming, isRecyclable, isTrendSpike,
  REACT_ENGAGEMENT_MULTIPLIER, REACT_MIN_SAMPLES, RECYCLE_COOLDOWN_DAYS,
} from "../src/domain/automation.js";

const at = (iso: string) => new Date(iso);

describe("isOverperforming", () => {
  it("true when engagement >= 1.5x niche average with enough samples", () => {
    expect(isOverperforming(0.09, 0.05, 5)).toBe(true);
  });
  it("false below the multiplier", () => {
    expect(isOverperforming(0.07, 0.05, 5)).toBe(false);
  });
  it("false with too few samples", () => {
    expect(isOverperforming(0.09, 0.05, REACT_MIN_SAMPLES - 1)).toBe(false);
  });
  it("false when niche average is zero or non-finite", () => {
    expect(isOverperforming(0.09, 0, 5)).toBe(false);
    expect(isOverperforming(0.09, NaN, 5)).toBe(false);
  });
  it("exact threshold counts (>=)", () => {
    expect(isOverperforming(0.05 * REACT_ENGAGEMENT_MULTIPLIER, 0.05, 5)).toBe(true);
  });
});

describe("isRecyclable", () => {
  const now = at("2026-07-15T12:00:00Z");
  it("true for an old enough winner", () => {
    expect(isRecyclable(at("2026-06-01T12:00:00Z"), 0.09, 0.05, 5, now)).toBe(true);
  });
  it("false inside the cooldown", () => {
    expect(isRecyclable(at("2026-07-01T12:00:00Z"), 0.09, 0.05, 5, now)).toBe(false);
  });
  it("cooldown boundary: exactly 30 days is eligible", () => {
    const published = new Date(now.getTime() - RECYCLE_COOLDOWN_DAYS * 86_400_000);
    expect(isRecyclable(published, 0.09, 0.05, 5, now)).toBe(true);
  });
  it("false when not a winner", () => {
    expect(isRecyclable(at("2026-06-01T12:00:00Z"), 0.06, 0.05, 5, now)).toBe(false);
  });
  it("false with insufficient samples or zero average", () => {
    expect(isRecyclable(at("2026-06-01T12:00:00Z"), 0.09, 0.05, 2, now)).toBe(false);
    expect(isRecyclable(at("2026-06-01T12:00:00Z"), 0.09, 0, 5, now)).toBe(false);
  });
});

describe("isTrendSpike", () => {
  const now = at("2026-07-15T12:00:00Z");
  it("fires on source accumulation: 3+ sources within first 6 hours", () => {
    expect(isTrendSpike(3, at("2026-07-15T07:00:00Z"), at("2026-07-15T11:00:00Z"), 0.2, now)).toBe(true);
  });
  it("does not fire when sources accumulated slowly", () => {
    expect(isTrendSpike(5, at("2026-07-10T12:00:00Z"), at("2026-07-15T11:00:00Z"), 0.2, now)).toBe(false);
  });
  it("fires on high velocity for a fresh topic", () => {
    expect(isTrendSpike(1, at("2026-07-15T08:00:00Z"), at("2026-07-15T08:00:00Z"), 0.85, now)).toBe(true);
  });
  it("does not fire on high velocity for an old topic", () => {
    expect(isTrendSpike(1, at("2026-07-10T08:00:00Z"), at("2026-07-10T09:00:00Z"), 0.85, now)).toBe(false);
  });
  it("does not fire for a quiet fresh topic", () => {
    expect(isTrendSpike(2, at("2026-07-15T08:00:00Z"), at("2026-07-15T09:00:00Z"), 0.3, now)).toBe(false);
  });
});
