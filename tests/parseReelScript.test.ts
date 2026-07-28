import { describe, expect, it } from "vitest";
import { parseReelScript } from "../src/remotion/parseReelScript.js";

describe("parseReelScript", () => {
  it("splits on blank lines", () => {
    expect(parseReelScript("one\n\ntwo\n\nthree")).toEqual(["one", "two", "three"]);
  });

  it("splits on section labels even without blank lines", () => {
    // The file always claimed labelled sections split; they never did, so a
    // labelled script on single newlines rendered as ONE slide.
    expect(parseReelScript("Hook: A\nBody: B\nCTA: C")).toEqual(["A", "B", "C"]);
  });

  it("handles bracketed labels, which the default template uses", () => {
    expect(parseReelScript("Hook: A\n[Body: B]\nCTA: C")).toEqual(["A", "B", "C"]);
  });

  it("strips the label but keeps the content", () => {
    expect(parseReelScript("Hook: Keep this")).toEqual(["Keep this"]);
  });

  it("keeps multi-line content inside one section together", () => {
    expect(parseReelScript("Hook: line one\ncontinues here\n\nCTA: end"))
      .toEqual(["line one\ncontinues here", "end"]);
  });

  it("treats an unlabelled single paragraph as one slide", () => {
    expect(parseReelScript("just one thought")).toEqual(["just one thought"]);
  });

  it("is case-insensitive about labels", () => {
    expect(parseReelScript("HOOK: A\ncta: B")).toEqual(["A", "B"]);
  });

  it("reports the empty state", () => {
    expect(parseReelScript("")).toEqual(["No script yet"]);
    expect(parseReelScript("   ")).toEqual(["No script yet"]);
  });

  it("ignores a colon that is not a section label", () => {
    // "Note:" is not a section, so this must stay one slide.
    expect(parseReelScript("Note: this is all one thought")).toEqual(["Note: this is all one thought"]);
  });
});
