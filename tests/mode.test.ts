import { afterEach, describe, expect, it } from "vitest";
import { resolveMode } from "../src/config/mode.js";

afterEach(() => { delete process.env.TPCE_MODE; });

describe("resolveMode", () => {
  it("defaults to server when unset", () => {
    delete process.env.TPCE_MODE;
    expect(resolveMode()).toBe("server");
  });
  it("returns desktop when TPCE_MODE=desktop", () => {
    process.env.TPCE_MODE = "desktop";
    expect(resolveMode()).toBe("desktop");
  });
  it("is case-insensitive and trims", () => {
    process.env.TPCE_MODE = " Desktop ";
    expect(resolveMode()).toBe("desktop");
  });
  it("falls back to server for unknown values", () => {
    process.env.TPCE_MODE = "banana";
    expect(resolveMode()).toBe("server");
  });
});
