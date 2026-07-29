import { describe, expect, it } from "vitest";
import { validateTrim, buildEditArgs, VERTICAL_FILTER } from "../src/domain/videoEdit.js";

describe("validateTrim", () => {
  it("accepts a sane range", () => {
    expect(validateTrim({ start: 2, end: 10, durationSec: 30 })).toBeNull();
  });
  it("accepts trimming nothing", () => {
    expect(validateTrim({ start: 0, end: null, durationSec: 30 })).toBeNull();
  });
  it("rejects an end before the start", () => {
    expect(validateTrim({ start: 10, end: 5, durationSec: 30 })).toMatch(/end.*after|before/i);
  });
  it("rejects a zero-length range rather than producing an empty file", () => {
    expect(validateTrim({ start: 5, end: 5, durationSec: 30 })).toMatch(/at least/i);
  });
  it("rejects a start beyond the clip", () => {
    expect(validateTrim({ start: 40, end: null, durationSec: 30 })).toMatch(/longer than|beyond/i);
  });
  it("tolerates unknown duration rather than blocking the edit", () => {
    // ffprobe could not read it; the trim will simply clamp itself.
    expect(validateTrim({ start: 2, end: 10, durationSec: null })).toBeNull();
  });
  it("rejects negative values", () => {
    expect(validateTrim({ start: -1, end: 5, durationSec: 30 })).toMatch(/negative|cannot/i);
  });
});

describe("buildEditArgs", () => {
  const base = { inputPath: "/in.mp4", outputPath: "/out.mp4" };

  it("puts -ss before -i so seeking is fast", () => {
    const a = buildEditArgs({ ...base, start: 5, end: null, toVertical: false });
    expect(a.indexOf("-ss")).toBeLessThan(a.indexOf("-i"));
  });
  it("uses -to for the end point", () => {
    const a = buildEditArgs({ ...base, start: 2, end: 8, toVertical: false });
    expect(a).toContain("-to");
    // -to is relative to the seek point once -ss precedes -i.
    expect(a[a.indexOf("-to") + 1]).toBe("6");
  });
  it("omits trim flags entirely when nothing is trimmed", () => {
    const a = buildEditArgs({ ...base, start: 0, end: null, toVertical: false });
    expect(a).not.toContain("-ss");
    expect(a).not.toContain("-to");
  });
  it("adds the vertical crop filter when asked", () => {
    const a = buildEditArgs({ ...base, start: 0, end: null, toVertical: true });
    expect(a).toContain("-vf");
    expect(a[a.indexOf("-vf") + 1]).toBe(VERTICAL_FILTER);
  });
  it("omits the filter when not converting", () => {
    expect(buildEditArgs({ ...base, start: 0, end: null, toVertical: false })).not.toContain("-vf");
  });
  it("always overwrites and ends with the output path", () => {
    const a = buildEditArgs({ ...base, start: 0, end: null, toVertical: false });
    expect(a[0]).toBe("-y");
    expect(a[a.length - 1]).toBe("/out.mp4");
  });
  it("re-encodes with codecs the bundled ffmpeg actually has", () => {
    const a = buildEditArgs({ ...base, start: 1, end: 5, toVertical: true });
    expect(a).toContain("libx264");
    expect(a).toContain("aac");
  });
});
