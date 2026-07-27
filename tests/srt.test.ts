import { describe, expect, it } from "vitest";
import { parseSrt, cueAtFrame } from "../src/domain/srt.js";

const SRT = `1
00:00:00,000 --> 00:00:02,000
First caption

2
00:00:02,000 --> 00:00:04,500
Second caption
`;

describe("parseSrt", () => {
  it("parses cues with start and end seconds", () => {
    const cues = parseSrt(SRT);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({ start: 0, end: 2, text: "First caption" });
    expect(cues[1]!.end).toBeCloseTo(4.5, 3);
  });
  it("joins multi-line cue text with a space", () => {
    const cues = parseSrt("1\n00:00:00,000 --> 00:00:01,000\nline one\nline two\n");
    expect(cues[0]!.text).toBe("line one line two");
  });
  it("tolerates CRLF and trailing blank lines", () => {
    expect(parseSrt(SRT.replace(/\n/g, "\r\n") + "\r\n\r\n")).toHaveLength(2);
  });
  it("returns [] for empty or malformed input rather than throwing", () => {
    expect(parseSrt("")).toEqual([]);
    expect(parseSrt("not an srt file")).toEqual([]);
  });
});

describe("cueAtFrame", () => {
  const cues = parseSrt(SRT);
  it("finds the cue covering a frame", () => {
    // frame 30 at 30fps = t=1.0s, inside cue 1.
    expect(cueAtFrame(cues, 30, 30)?.text).toBe("First caption");
  });
  it("returns null after the last cue", () => {
    expect(cueAtFrame(cues, 300, 30)).toBeNull();   // t=10s
  });
  it("treats the cue end as exclusive so two cues never overlap", () => {
    // t=2.0s belongs to cue 2, not cue 1.
    expect(cueAtFrame(cues, 60, 30)?.text).toBe("Second caption");
  });
});
