import { describe, expect, it } from "vitest";
import { keywordize } from "../src/services/ingestion/keywordize.js";

describe("keywordize compound-fragment dedupe", () => {
  it("suppresses single-word fragments of an emitted compound", () => {
    const out = keywordize("Artificial intelligence tools transform budgeting");
    expect(out).toContain("artificial intelligence");
    expect(out).not.toContain("artificial");
    expect(out).not.toContain("intelligence");
  });

  it("keeps unrelated single words alongside a compound", () => {
    const out = keywordize("machine learning improves budget forecasts");
    expect(out).toContain("machine learning");
    expect(out).toContain("budget");
    expect(out).toContain("forecasts");
    expect(out).not.toContain("machine");
    expect(out).not.toContain("learning");
  });
});
