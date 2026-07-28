import { describe, expect, it } from "vitest";
import {
  MIN_SLIDES, MAX_SLIDES, DEFAULT_SLIDES,
  resolveSlideCount, isAcceptableCarousel,
} from "../src/domain/slideCount.js";

describe("resolveSlideCount", () => {
  it("uses the default when nothing is set", () => {
    expect(resolveSlideCount({})).toBe(DEFAULT_SLIDES);
  });
  it("uses the page default when there is no content override", () => {
    expect(resolveSlideCount({ pageDefault: 5 })).toBe(5);
  });
  it("lets a content override beat the page default", () => {
    expect(resolveSlideCount({ pageDefault: 5, contentOverride: 10 })).toBe(10);
  });
  it("clamps rather than rejecting, so a bad value never blocks generation", () => {
    expect(resolveSlideCount({ contentOverride: 99 })).toBe(MAX_SLIDES);
    expect(resolveSlideCount({ contentOverride: 1 })).toBe(MIN_SLIDES);
  });
  it("ignores non-numeric and non-integer values", () => {
    expect(resolveSlideCount({ contentOverride: "abc" as any })).toBe(DEFAULT_SLIDES);
    expect(resolveSlideCount({ pageDefault: NaN })).toBe(DEFAULT_SLIDES);
    expect(resolveSlideCount({ contentOverride: 6.5 })).toBe(DEFAULT_SLIDES);
  });
});

describe("isAcceptableCarousel", () => {
  it("accepts anything within range rather than demanding an exact count", () => {
    // The old check was `length === 8`, which silently threw away a perfectly
    // good 7- or 9-slide carousel and substituted generic fallback content.
    for (const n of [MIN_SLIDES, 7, 8, 9, MAX_SLIDES]) {
      expect(isAcceptableCarousel(new Array(n).fill({}))).toBe(true);
    }
  });
  it("rejects counts outside the range", () => {
    expect(isAcceptableCarousel(new Array(MIN_SLIDES - 1).fill({}))).toBe(false);
    expect(isAcceptableCarousel(new Array(MAX_SLIDES + 1).fill({}))).toBe(false);
  });
  it("rejects a non-array or empty result", () => {
    expect(isAcceptableCarousel(undefined)).toBe(false);
    expect(isAcceptableCarousel(null)).toBe(false);
    expect(isAcceptableCarousel([])).toBe(false);
  });
});

import { carouselToEditorSlides } from "../src/domain/slideCount.js";

describe("carouselToEditorSlides", () => {
  it("maps generated carousel entries into editor slides", () => {
    // The generator stores payload.carousel as {slide,title,body}; the editor
    // reads {id,text}. The mismatch meant generated slides were never shown.
    expect(carouselToEditorSlides([
      { slide: 1, title: "Hook", body: "Big claim" },
      { slide: 2, title: "Point", body: "Detail" },
    ])).toEqual([
      { id: 1, text: "Hook\nBig claim" },
      { id: 2, text: "Point\nDetail" },
    ]);
  });
  it("tolerates a missing title or body", () => {
    expect(carouselToEditorSlides([{ slide: 1, title: "Only title" }]))
      .toEqual([{ id: 1, text: "Only title" }]);
    expect(carouselToEditorSlides([{ slide: 1, body: "Only body" }]))
      .toEqual([{ id: 1, text: "Only body" }]);
  });
  it("falls back to positional ids when slide numbers are missing", () => {
    expect(carouselToEditorSlides([{ title: "a" }, { title: "b" }]))
      .toEqual([{ id: 1, text: "a" }, { id: 2, text: "b" }]);
  });
  it("drops entries with no usable text rather than adding blank slides", () => {
    expect(carouselToEditorSlides([{ slide: 1 }, { slide: 2, title: "keep" }]))
      .toEqual([{ id: 2, text: "keep" }]);
  });
  it("returns [] for anything that is not an array", () => {
    expect(carouselToEditorSlides(undefined)).toEqual([]);
    expect(carouselToEditorSlides("nope" as any)).toEqual([]);
  });
});
