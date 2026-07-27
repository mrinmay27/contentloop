import { describe, expect, it } from "vitest";
import { creditLine, creditsFor, type Attribution } from "../src/domain/attribution.js";

const a = (over: Partial<Attribution> = {}): Attribution => ({
  provider: "pexels", author: "Ruvim Miksanskiy",
  sourceUrl: "https://www.pexels.com/video/ocean-8471234/", ...over,
});

describe("creditLine", () => {
  it("names the author and the provider", () => {
    expect(creditLine(a())).toBe("Ruvim Miksanskiy · Pexels");
  });
  it("falls back to the provider alone when the author is unknown", () => {
    // Pexels omits the author on some video records — credit what we have
    // rather than printing "undefined".
    expect(creditLine(a({ author: undefined }))).toBe("Pexels");
    expect(creditLine(a({ author: "  " }))).toBe("Pexels");
  });
});

describe("creditsFor", () => {
  it("returns one line per distinct author", () => {
    expect(creditsFor([a(), a({ author: "Someone Else" })]))
      .toEqual(["Ruvim Miksanskiy · Pexels", "Someone Else · Pexels"]);
  });
  it("de-duplicates repeated authors — three clips by one person is one credit", () => {
    expect(creditsFor([a(), a(), a()])).toEqual(["Ruvim Miksanskiy · Pexels"]);
  });
  it("skips entries with no attribution rather than emitting blanks", () => {
    expect(creditsFor([null, undefined, a()] as any)).toEqual(["Ruvim Miksanskiy · Pexels"]);
  });
  it("returns [] when nothing needs crediting", () => {
    expect(creditsFor([])).toEqual([]);
    expect(creditsFor([null] as any)).toEqual([]);
  });
});
