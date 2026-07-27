import { describe, expect, it } from "vitest";
import { segmentsToSrt, srtTimestamp } from "../src/services/transcribe.js";

describe("srtTimestamp", () => {
  it("formats SRT timestamps", () => {
    expect(srtTimestamp(0)).toBe("00:00:00,000");
    expect(srtTimestamp(61.5)).toBe("00:01:01,500");
    expect(srtTimestamp(3661.25)).toBe("01:01:01,250");
  });
  it("clamps negatives to zero rather than emitting invalid SRT", () => {
    expect(srtTimestamp(-1)).toBe("00:00:00,000");
  });
});

describe("segmentsToSrt", () => {
  it("numbers cues from 1 and separates them with a blank line", () => {
    const srt = segmentsToSrt([
      { start: 0, end: 1.5, text: "Hello there" },
      { start: 1.5, end: 3, text: "Second line" },
    ]);
    expect(srt).toContain("1\n00:00:00,000 --> 00:00:01,500\nHello there");
    expect(srt).toContain("2\n00:00:01,500 --> 00:00:03,000\nSecond line");
  });
  it("trims whitespace Whisper leaves on segments", () => {
    expect(segmentsToSrt([{ start: 0, end: 1, text: "  padded  " }])).toContain("padded");
  });
  it("skips empty segments rather than emitting blank cues", () => {
    const srt = segmentsToSrt([
      { start: 0, end: 1, text: "" }, { start: 1, end: 2, text: "real" },
    ]);
    expect(srt.trim().startsWith("1")).toBe(true);
    expect(srt).toContain("real");
    expect(srt.split("-->").length - 1).toBe(1);
  });
  it("returns an empty string for no segments", () => {
    expect(segmentsToSrt([])).toBe("");
  });
});
