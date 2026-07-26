import { describe, expect, it } from "vitest";
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
