import { describe, expect, it } from "vitest";
import { isNodeVersionOk, depsHash, MIN_NODE_MAJOR } from "../scripts/launcher/lib.mjs";

describe("isNodeVersionOk", () => {
  it("accepts the minimum major and newer", () => {
    expect(isNodeVersionOk(`v${MIN_NODE_MAJOR}.0.0`)).toBe(true);
    expect(isNodeVersionOk(`v${MIN_NODE_MAJOR + 2}.5.1`)).toBe(true);
  });
  it("accepts a system Node newer than the minimum but older than the pinned download", () => {
    // We DOWNLOAD v24, but an existing v20/v22 is perfectly fine to reuse —
    // forcing a 50 MB download on those users would be gratuitous.
    expect(isNodeVersionOk("v22.11.0")).toBe(true);
  });
  it("rejects older majors", () => {
    expect(isNodeVersionOk(`v${MIN_NODE_MAJOR - 1}.9.9`)).toBe(false);
    expect(isNodeVersionOk("v18.20.4")).toBe(false);
  });
  it("tolerates a missing leading v", () => {
    expect(isNodeVersionOk(`${MIN_NODE_MAJOR}.1.0`)).toBe(true);
  });
  it("rejects garbage rather than assuming ok", () => {
    expect(isNodeVersionOk("")).toBe(false);
    expect(isNodeVersionOk("not-a-version")).toBe(false);
    expect(isNodeVersionOk(undefined as unknown as string)).toBe(false);
  });
});

describe("depsHash", () => {
  it("is stable for identical content", () => {
    expect(depsHash("abc")).toBe(depsHash("abc"));
  });
  it("changes when the lockfile changes", () => {
    expect(depsHash("abc")).not.toBe(depsHash("abd"));
  });
  it("returns a short hex digest", () => {
    expect(depsHash("abc")).toMatch(/^[0-9a-f]{16}$/);
  });
});
