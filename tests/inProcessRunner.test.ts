import { describe, expect, it } from "vitest";
import { isJobDue, JOB_CADENCE, CATCH_UP_JOBS } from "../src/worker/inProcessRunner.js";
import { JOB_NAMES } from "../src/worker/jobs.js";

const at = (iso: string) => new Date(iso);

describe("isJobDue", () => {
  const now = at("2026-07-24T12:00:00Z");

  it("is due when never run before", () => {
    expect(isJobDue(null, 60 * 60_000, now)).toBe(true);
  });
  it("is due exactly at the interval boundary", () => {
    expect(isJobDue(at("2026-07-24T11:00:00Z"), 60 * 60_000, now)).toBe(true);
  });
  it("is not due before the interval elapses", () => {
    expect(isJobDue(at("2026-07-24T11:30:00Z"), 60 * 60_000, now)).toBe(false);
  });
  it("is due long after the interval", () => {
    expect(isJobDue(at("2026-07-20T11:00:00Z"), 60 * 60_000, now)).toBe(true);
  });
  it("treats a future last-run (clock skew) as not due", () => {
    expect(isJobDue(at("2026-07-24T13:00:00Z"), 60 * 60_000, now)).toBe(false);
  });
});

describe("cadence table", () => {
  it("covers every job exactly once", () => {
    expect(Object.keys(JOB_CADENCE).sort()).toEqual([...JOB_NAMES].sort());
  });
  it("uses positive intervals", () => {
    for (const ms of Object.values(JOB_CADENCE)) expect(ms).toBeGreaterThan(0);
  });
  it("catch-up starts with post (publishing a due job is the priority)", () => {
    expect(CATCH_UP_JOBS[0]).toBe("post");
  });
  it("catch-up only contains known jobs and excludes heavy media/render", () => {
    for (const name of CATCH_UP_JOBS) expect(JOB_NAMES).toContain(name);
    expect(CATCH_UP_JOBS).not.toContain("media");
    expect(CATCH_UP_JOBS).not.toContain("render");
  });
});

describe("runJobGuarded", () => {
  it("is exported so the API route can share the runner's in-flight guard", async () => {
    const mod = await import("../src/worker/inProcessRunner.js");
    expect(typeof mod.runJobGuarded).toBe("function");
  });
});
