import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import { resolveDataDir } from "../src/db/embedded.js";

afterEach(() => { delete process.env.TPCE_DATA_DIR; });

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
