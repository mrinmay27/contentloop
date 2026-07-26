import { describe, expect, it } from "vitest";
import { effectiveValue } from "../src/services/ingestion/effectiveSources.js";

describe("effectiveValue", () => {
  it("uses the override when it is non-empty", () => {
    expect(effectiveValue(["a", "b"], ["x"])).toEqual({ values: ["a", "b"], isDefault: false });
  });
  it("falls back to the default when the override is empty", () => {
    expect(effectiveValue([], ["x", "y"])).toEqual({ values: ["x", "y"], isDefault: true });
  });
  it("falls back when the override is undefined", () => {
    expect(effectiveValue(undefined, ["x"])).toEqual({ values: ["x"], isDefault: true });
  });
  it("returns an empty default-flagged list when neither exists", () => {
    expect(effectiveValue(undefined, [])).toEqual({ values: [], isDefault: true });
  });
});
