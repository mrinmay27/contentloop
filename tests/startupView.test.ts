import { describe, expect, it } from "vitest";
import { resolveStartupView } from "../src/web/lib/startupView.js";

describe("resolveStartupView", () => {
  it("shows the spinner only while the request is genuinely in flight", () => {
    expect(resolveStartupView({ status: "loading", pageCount: 0 })).toBe("loading");
  });

  it("shows an error screen when pages could not be fetched", () => {
    // Regression: this used to fall through to an eternal spinner because the
    // fetch error was swallowed and the loading branch returned first.
    expect(resolveStartupView({ status: "error", pageCount: 0 })).toBe("error");
  });

  it("shows the welcome screen on a fresh install with no pages", () => {
    // Regression: a brand-new user (GET /api/pages -> []) previously saw
    // "Loading pages…" forever, with no way to reach the create-page wizard.
    expect(resolveStartupView({ status: "ready", pageCount: 0 })).toBe("welcome");
  });

  it("shows the app once at least one page exists", () => {
    expect(resolveStartupView({ status: "ready", pageCount: 1 })).toBe("app");
    expect(resolveStartupView({ status: "ready", pageCount: 12 })).toBe("app");
  });

  it("prefers the error screen over the welcome screen", () => {
    // An unreachable API must never be mistaken for "you have no pages yet",
    // which would invite the user to create a page that cannot be saved.
    expect(resolveStartupView({ status: "error", pageCount: 0 })).not.toBe("welcome");
  });
});
