import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { SOURCE_REGISTRY } from "../src/services/ingestion/sourceRegistry.js";

describe("SOURCE_REGISTRY", () => {
  it("covers every source id dispatched by ingestForNiche", () => {
    const src = fs.readFileSync("src/services/ingestion/index.ts", "utf-8");
    const dispatched = [...src.matchAll(/isEnabled\("([a-z_]+)"\)/g)].map((m) => m[1]);
    expect(dispatched.length).toBeGreaterThanOrEqual(14);
    const registryIds = SOURCE_REGISTRY.map((s) => s.id);
    for (const id of dispatched) expect(registryIds).toContain(id);
  });

  it("has unique ids and non-empty labels/descriptions", () => {
    const ids = SOURCE_REGISTRY.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SOURCE_REGISTRY) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.description.length).toBeGreaterThan(0);
    }
  });

  it("configFields reference known kinds", () => {
    for (const s of SOURCE_REGISTRY)
      for (const f of s.configFields)
        expect(["strings", "feeds"]).toContain(f.kind);
  });
});
