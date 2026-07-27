import { describe, expect, it } from "vitest";
import { parseProbeOutput, describeRejection } from "../src/services/mediaProbe.js";

const raw = [
  "codec_name=h264", "width=1080", "height=1920", "duration=12.053333",
].join("\n");

describe("parseProbeOutput", () => {
  it("parses ffprobe's key=value output", () => {
    expect(parseProbeOutput(raw)).toEqual({
      codec: "h264", width: 1080, height: 1920, durationSec: 12.053333,
    });
  });

  it("returns null when there is no video stream rather than inventing zeros", () => {
    expect(parseProbeOutput("")).toBeNull();
    expect(parseProbeOutput("codec_name=aac")).toBeNull();
  });

  it("tolerates ffprobe reporting duration as N/A", () => {
    // Some containers omit it; dimensions are still usable.
    const out = parseProbeOutput("codec_name=h264\nwidth=1080\nheight=1920\nduration=N/A");
    expect(out?.durationSec).toBeNull();
    expect(out?.width).toBe(1080);
  });

  it("ignores stray blank lines and carriage returns", () => {
    expect(parseProbeOutput("codec_name=h264\r\nwidth=1080\r\n\r\nheight=1920\r\n")?.height).toBe(1920);
  });
});

describe("describeRejection", () => {
  it("accepts a vertical h264 clip of reasonable length", () => {
    expect(describeRejection({ codec: "h264", width: 1080, height: 1920, durationSec: 30 })).toBeNull();
  });

  it("explains a non-vertical clip in plain language", () => {
    const msg = describeRejection({ codec: "h264", width: 1920, height: 1080, durationSec: 30 });
    expect(msg).toMatch(/vertical|9:16/i);
    expect(msg).not.toMatch(/codec/i);
  });

  it("rejects a clip too long for Shorts", () => {
    expect(describeRejection({ codec: "h264", width: 1080, height: 1920, durationSec: 200 }))
      .toMatch(/3 min|too long/i);
  });

  it("accepts a clip with unknown duration rather than guessing", () => {
    // ffprobe could not read it; the platform will reject it later if invalid.
    expect(describeRejection({ codec: "h264", width: 1080, height: 1920, durationSec: null })).toBeNull();
  });
});
