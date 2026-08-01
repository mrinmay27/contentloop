import { describe, expect, it, afterEach } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDataDir, resolveMediaDir } from "../src/config/paths.js";

const saved = process.env.CONTENTLOOP_DATA_DIR;
afterEach(() => {
  if (saved === undefined) delete process.env.CONTENTLOOP_DATA_DIR;
  else process.env.CONTENTLOOP_DATA_DIR = saved;
});

describe("resolveDataDir", () => {
  it("honours CONTENTLOOP_DATA_DIR", () => {
    process.env.CONTENTLOOP_DATA_DIR = "/tmp/some-install";
    expect(resolveDataDir()).toBe("/tmp/some-install");
    // Config and media must land in the same place, or a second install
    // silently shares the first one's API keys and OAuth secrets.
    expect(resolveMediaDir()).toBe(path.join("/tmp/some-install", "media"));
  });

  it("falls back to cwd/data when unset, so existing installs do not move", () => {
    delete process.env.CONTENTLOOP_DATA_DIR;
    expect(resolveDataDir()).toBe(path.resolve(process.cwd(), "data"));
  });
});

describe("resolving paths from import.meta.url", () => {
  // The bug this guards: `new URL(".", import.meta.url).pathname` leaves
  // percent-encoding in place, so an install under a directory with a space —
  // "Theme Page Content Engine", "My Drive", any macOS user with a space in
  // their name — resolved to a literal "%20" folder. Settings were written to
  // a phantom directory beside the real one and vanished if the app was ever
  // run from a clean path.
  it("decodes escaped characters, unlike .pathname", () => {
    const url = new URL("file:///Users/x/My%20Project/dist/src/config/");
    expect(url.pathname).toContain("%20");
    expect(fileURLToPath(url)).toBe("/Users/x/My Project/dist/src/config/");
    expect(fileURLToPath(url)).not.toContain("%20");
  });
});
