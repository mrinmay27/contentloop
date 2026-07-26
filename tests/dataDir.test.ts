import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import { resolveDataDir } from "../src/db/embedded.js";

afterEach(() => { delete process.env.TPCE_DATA_DIR; delete process.env.CONTENTLOOP_DATA_DIR; });

describe("resolveDataDir", () => {
  it("honours TPCE_DATA_DIR and returns an absolute path", () => {
    process.env.TPCE_DATA_DIR = "./tmp-data";
    expect(path.isAbsolute(resolveDataDir())).toBe(true);
    expect(resolveDataDir().endsWith("tmp-data")).toBe(true);
  });

  it("falls back to a per-OS app dir containing TPCE", () => {
    delete process.env.TPCE_DATA_DIR;
    const dir = resolveDataDir();
    expect(path.isAbsolute(dir)).toBe(true);
    expect(dir.toLowerCase()).toContain("tpce");
  });
});

describe("data dir rename compatibility", () => {
  it("honours CONTENTLOOP_DATA_DIR", () => {
    process.env.CONTENTLOOP_DATA_DIR = "./cl-data";
    expect(resolveDataDir().endsWith("cl-data")).toBe(true);
  });
  it("still honours the legacy TPCE_DATA_DIR", () => {
    process.env.TPCE_DATA_DIR = "./legacy-data";
    expect(resolveDataDir().endsWith("legacy-data")).toBe(true);
  });
});
