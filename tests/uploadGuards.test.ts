import { describe, expect, it } from "vitest";
import { isAcceptedVideoType, resolveMaxUploadBytes } from "../src/domain/uploadGuards.js";

describe("isAcceptedVideoType", () => {
  it("accepts the container types we can probe and render", () => {
    expect(isAcceptedVideoType("video/mp4")).toBe(true);
    expect(isAcceptedVideoType("video/quicktime")).toBe(true);
    expect(isAcceptedVideoType("video/webm")).toBe(true);
  });
  it("is case and parameter tolerant", () => {
    expect(isAcceptedVideoType("VIDEO/MP4")).toBe(true);
    expect(isAcceptedVideoType("video/mp4; codecs=avc1")).toBe(true);
  });
  it("rejects non-video and missing types", () => {
    expect(isAcceptedVideoType("image/png")).toBe(false);
    expect(isAcceptedVideoType("application/pdf")).toBe(false);
    expect(isAcceptedVideoType("")).toBe(false);
    expect(isAcceptedVideoType(undefined)).toBe(false);
  });
});

describe("resolveMaxUploadBytes", () => {
  it("defaults to 500 MB", () => {
    expect(resolveMaxUploadBytes(undefined)).toBe(500 * 1024 * 1024);
  });
  it("honours a configured value in megabytes", () => {
    expect(resolveMaxUploadBytes("100")).toBe(100 * 1024 * 1024);
  });
  it("falls back to the default for nonsense rather than allowing unlimited", () => {
    expect(resolveMaxUploadBytes("abc")).toBe(500 * 1024 * 1024);
    expect(resolveMaxUploadBytes("-5")).toBe(500 * 1024 * 1024);
    expect(resolveMaxUploadBytes("0")).toBe(500 * 1024 * 1024);
  });
});
