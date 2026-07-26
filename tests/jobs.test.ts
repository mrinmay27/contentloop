import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { JOB_NAMES, JOBS } from "../src/worker/jobs.js";

describe("job registry", () => {
  it("exports exactly the eight pipeline jobs", () => {
    expect([...JOB_NAMES].sort()).toEqual(
      ["analyze", "generate", "ingest", "media", "post", "render", "schedule", "score"]
    );
  });

  it("every name maps to a callable function", () => {
    for (const name of JOB_NAMES) expect(typeof JOBS[name]).toBe("function");
  });

  it("JOBS has no extra keys beyond JOB_NAMES", () => {
    expect(Object.keys(JOBS).sort()).toEqual([...JOB_NAMES].sort());
  });
});

describe("job-name parity with the API route", () => {
  it("POST /api/jobs/:name accepts exactly the registry's job names", () => {
    // server.ts hardcodes the enum (a static jobs.ts import would pull the
    // whole generation stack into the API process) — this keeps them honest.
    const src = fs.readFileSync("src/api/server.ts", "utf-8");
    const match = src.match(/name: z\.enum\(\[([^\]]+)\]\)/);
    expect(match).toBeTruthy();
    const routeNames = match![1].split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
    expect(routeNames.sort()).toEqual([...JOB_NAMES].sort());
  });
});
