import { describe, expect, it } from "vitest";
import { applySourceDiversityCap, DEFAULT_MAX_PER_SOURCE } from "../src/domain/sourceDiversity.js";

const t = (id: string, source: string, score: number, decision = "selected" as const) =>
  ({ id, source, score, decision });

describe("applySourceDiversityCap", () => {
  it("keeps everything when no source exceeds the cap", () => {
    const out = applySourceDiversityCap([
      t("a", "reddit", 0.9), t("b", "hacker_news", 0.8),
    ], 2);
    expect(out.every(x => x.decision === "selected")).toBe(true);
  });

  it("demotes the weakest excess topics from an over-represented source", () => {
    // One prolific feed must not fill the whole day's queue.
    const out = applySourceDiversityCap([
      t("a", "reddit", 0.9), t("b", "reddit", 0.8),
      t("c", "reddit", 0.7), t("d", "reddit", 0.6),
    ], 2);
    expect(out.filter(x => x.decision === "selected").map(x => x.id)).toEqual(["a", "b"]);
    expect(out.filter(x => x.decision === "backup").map(x => x.id)).toEqual(["c", "d"]);
  });

  it("keeps the HIGHEST scoring ones, not the first seen", () => {
    const out = applySourceDiversityCap([
      t("low", "reddit", 0.2), t("high", "reddit", 0.95), t("mid", "reddit", 0.6),
    ], 1);
    expect(out.find(x => x.id === "high")!.decision).toBe("selected");
    expect(out.find(x => x.id === "mid")!.decision).toBe("backup");
    expect(out.find(x => x.id === "low")!.decision).toBe("backup");
  });

  it("caps each source independently", () => {
    const out = applySourceDiversityCap([
      t("r1", "reddit", 0.9), t("r2", "reddit", 0.8), t("r3", "reddit", 0.7),
      t("h1", "hacker_news", 0.6), t("h2", "hacker_news", 0.5),
    ], 2);
    const kept = out.filter(x => x.decision === "selected").map(x => x.id);
    expect(kept).toEqual(["r1", "r2", "h1", "h2"]);
  });

  it("never promotes: backup and discarded stay put", () => {
    const out = applySourceDiversityCap([
      { id: "a", source: "reddit", score: 0.9, decision: "backup" },
      { id: "b", source: "reddit", score: 0.8, decision: "discarded" },
    ], 2);
    expect(out.find(x => x.id === "a")!.decision).toBe("backup");
    expect(out.find(x => x.id === "b")!.decision).toBe("discarded");
  });

  it("does not count non-selected topics against the cap", () => {
    // Two backups from reddit must not push a good selected one out.
    const out = applySourceDiversityCap([
      { id: "x", source: "reddit", score: 0.5, decision: "backup" },
      { id: "y", source: "reddit", score: 0.4, decision: "backup" },
      t("z", "reddit", 0.9),
    ], 2);
    expect(out.find(x => x.id === "z")!.decision).toBe("selected");
  });

  it("treats a missing source as its own bucket rather than crashing", () => {
    const out = applySourceDiversityCap([
      { id: "a", source: undefined, score: 0.9, decision: "selected" },
      { id: "b", source: undefined, score: 0.8, decision: "selected" },
    ], 1);
    expect(out.filter(x => x.decision === "selected")).toHaveLength(1);
  });

  it("is a no-op for a cap of zero or less, rather than emptying the queue", () => {
    const topics = [t("a", "reddit", 0.9), t("b", "reddit", 0.8)];
    expect(applySourceDiversityCap(topics, 0).every(x => x.decision === "selected")).toBe(true);
    expect(applySourceDiversityCap(topics, -1).every(x => x.decision === "selected")).toBe(true);
  });

  it("has a sane default cap", () => {
    expect(DEFAULT_MAX_PER_SOURCE).toBeGreaterThan(0);
  });
});
