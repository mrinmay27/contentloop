import { afterEach, describe, expect, it } from "vitest";
import {
  applyAutomationOverrides, getAutomationThresholds,
} from "../src/domain/automation.js";
import {
  applySourceQualityOverrides, sourceQualityMultiplier,
} from "../src/domain/scoring.js";

afterEach(() => {
  applyAutomationOverrides(null);        // null = reset to defaults
  applySourceQualityOverrides(null);
});

describe("applyAutomationOverrides", () => {
  it("applies partial overrides and reports effective values", () => {
    applyAutomationOverrides({ reactEngagementMultiplier: 2.0 });
    const t = getAutomationThresholds();
    expect(t.reactEngagementMultiplier).toBe(2.0);
    expect(t.recycleCooldownDays).toBe(30); // untouched default
  });
  it("clamps to sane ranges and ignores non-finite values", () => {
    applyAutomationOverrides({ reactEngagementMultiplier: -5, recycleCooldownDays: NaN } as any);
    const t = getAutomationThresholds();
    expect(t.reactEngagementMultiplier).toBeGreaterThanOrEqual(1);
    expect(t.recycleCooldownDays).toBe(30);
  });
  it("null resets to defaults", () => {
    applyAutomationOverrides({ trendVelocityFloor: 0.1 });
    applyAutomationOverrides(null);
    expect(getAutomationThresholds().trendVelocityFloor).toBe(0.8);
  });
});

describe("applySourceQualityOverrides", () => {
  it("overrides one source, leaves others", () => {
    applySourceQualityOverrides({ reddit: 1.4 });
    expect(sourceQualityMultiplier("reddit")).toBe(1.4);
    expect(sourceQualityMultiplier("hacker_news")).toBe(1.3);
  });
  it("clamps to [0.1, 3] and resets on null", () => {
    applySourceQualityOverrides({ rss: 99 });
    expect(sourceQualityMultiplier("rss")).toBeLessThanOrEqual(3);
    applySourceQualityOverrides(null);
    expect(sourceQualityMultiplier("rss")).toBe(0.95);
  });
});
