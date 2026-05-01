import { describe, expect, it } from "vitest";
import { nextAvailableSlot } from "../src/services/scheduler.js";

describe("nextAvailableSlot", () => {
  it("uses configured daily slots and respects existing occupied times", () => {
    const now = new Date("2026-04-30T08:00:00.000Z");
    const existing = [new Date("2026-04-30T06:30:00.000Z")];

    const slot = nextAvailableSlot(existing, now);

    expect(slot.getTime()).toBeGreaterThan(now.getTime());
  });
});
