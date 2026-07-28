import { describe, expect, it } from "vitest";
import { resolveDiscoveryMode, shouldIngestNiche } from "../src/domain/discovery.js";

describe("resolveDiscoveryMode", () => {
  it("defaults to auto when unset", () => {
    expect(resolveDiscoveryMode(undefined)).toBe("auto");
    expect(resolveDiscoveryMode({})).toBe("auto");
  });
  it("reads a stored choice", () => {
    expect(resolveDiscoveryMode({ discovery: "manual" })).toBe("manual");
  });
  it("falls back to auto on an unknown value, never silently disabling", () => {
    // Disabling someone's pipeline by accident is far worse than ignoring junk.
    expect(resolveDiscoveryMode({ discovery: "nonsense" })).toBe("auto");
    expect(resolveDiscoveryMode({ discovery: "" })).toBe("auto");
  });
});

describe("shouldIngestNiche", () => {
  const page = (discovery?: string) => ({ brand: discovery ? { discovery } : {} });

  it("ingests when a page wants discovery", () => {
    expect(shouldIngestNiche([page("auto")])).toBe(true);
  });
  it("skips when every page is manual", () => {
    expect(shouldIngestNiche([page("manual"), page("manual")])).toBe(false);
  });
  it("ingests a mixed niche — one automatic page must not be starved by a manual one", () => {
    expect(shouldIngestNiche([page("manual"), page("auto")])).toBe(true);
  });
  it("ingests when a niche has no pages yet, since nothing has opted out", () => {
    expect(shouldIngestNiche([])).toBe(true);
  });
  it("treats a page with no brand as automatic", () => {
    expect(shouldIngestNiche([{} as any])).toBe(true);
  });
});
