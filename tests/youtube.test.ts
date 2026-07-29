import { describe, expect, it } from "vitest";
import {
  MAX_TITLE, needsRefresh, buildTitle, describeShortRejection,
  interpretChannelResponse,
} from "../src/domain/youtube.js";

describe("buildTitle", () => {
  it("passes a short hook through", () => {
    expect(buildTitle("Three AI tools that save hours")).toBe("Three AI tools that save hours");
  });
  it("truncates on a word boundary, not mid-word", () => {
    const long = "word ".repeat(40).trim();
    const out = buildTitle(long);
    expect(out.length).toBeLessThanOrEqual(MAX_TITLE);
    expect(out.endsWith("wor")).toBe(false);
  });
  it("never exceeds YouTube's limit", () => {
    expect(buildTitle("x".repeat(500)).length).toBeLessThanOrEqual(MAX_TITLE);
  });
  it("falls back rather than sending an empty title", () => {
    // The API rejects an empty title, which would fail the whole publish.
    expect(buildTitle("").length).toBeGreaterThan(0);
    expect(buildTitle("   ").length).toBeGreaterThan(0);
  });
  it("collapses newlines so a multi-line hook stays one title", () => {
    expect(buildTitle("line one\n\nline two")).toBe("line one line two");
  });
});

describe("describeShortRejection", () => {
  it("accepts a vertical clip within the limit", () => {
    expect(describeShortRejection({ width: 1080, height: 1920, durationSec: 45 })).toBeNull();
  });
  it("explains a too-long clip in plain language", () => {
    expect(describeShortRejection({ width: 1080, height: 1920, durationSec: 400 }))
      .toMatch(/3 min|too long/i);
  });
  it("explains a non-vertical clip", () => {
    expect(describeShortRejection({ width: 1920, height: 1080, durationSec: 30 }))
      .toMatch(/vertical|9:16/i);
  });
  it("accepts unknown duration rather than guessing", () => {
    expect(describeShortRejection({ width: 1080, height: 1920, durationSec: null })).toBeNull();
  });
});

describe("needsRefresh", () => {
  const now = new Date("2026-07-28T12:00:00Z");
  it("refreshes when the token has already expired", () => {
    expect(needsRefresh(new Date("2026-07-28T11:00:00Z"), now)).toBe(true);
  });
  it("refreshes inside the safety window, before it actually expires", () => {
    // A token valid for 2 more minutes will die mid-upload.
    expect(needsRefresh(new Date("2026-07-28T12:02:00Z"), now)).toBe(true);
  });
  it("does not refresh a comfortably valid token", () => {
    expect(needsRefresh(new Date("2026-07-28T12:59:00Z"), now)).toBe(false);
  });
  it("refreshes when expiry is unknown", () => {
    // Safer to refresh needlessly than to upload with a dead token.
    expect(needsRefresh(null, now)).toBe(true);
  });
});

describe("interpretChannelResponse", () => {
  it("reads the channel out of a normal response", () => {
    expect(interpretChannelResponse(true, {
      items: [{ id: "UC123", snippet: { title: "Inside Money" } }],
    })).toEqual({ status: "ok", id: "UC123", title: "Inside Money" });
  });

  // The real shape from a Google account with no channel: 200, and no `items`
  // key at all. An earlier version tested for an empty array and so read this
  // as "unknown", silently hiding the one problem worth warning about.
  it("treats a 200 with no items key as no channel", () => {
    expect(interpretChannelResponse(true, {
      kind: "youtube#channelListResponse",
      pageInfo: { totalResults: 0, resultsPerPage: 5 },
    })).toEqual({ status: "no_channel" });
  });

  it("treats an explicitly empty items array as no channel too", () => {
    expect(interpretChannelResponse(true, { items: [] })).toEqual({ status: "no_channel" });
  });

  // A failed request says nothing about whether a channel exists, so it must
  // not report no-channel — that would tell users to create one they have.
  it("does not claim no-channel when the request failed", () => {
    expect(interpretChannelResponse(false, null)).toEqual({ status: "unknown" });
  });

  it("falls back to the id when the channel has no title", () => {
    expect(interpretChannelResponse(true, { items: [{ id: "UC9" }] }))
      .toEqual({ status: "ok", id: "UC9", title: "UC9" });
  });
});
