import { describe, expect, it } from "vitest";
import { pendingMigrations } from "../src/db/migrate.js";

describe("pendingMigrations", () => {
  const files = ["002_embeddings.sql", "001_baseline.sql", "003_clean.sql"];

  it("sorts by filename and filters out applied versions", () => {
    expect(pendingMigrations(files, ["001_baseline.sql"])).toEqual([
      "002_embeddings.sql",
      "003_clean.sql",
    ]);
  });

  it("returns all sorted when nothing applied", () => {
    expect(pendingMigrations(files, [])).toEqual([
      "001_baseline.sql", "002_embeddings.sql", "003_clean.sql",
    ]);
  });

  it("returns empty when all applied", () => {
    expect(pendingMigrations(files, [...files])).toEqual([]);
  });

  it("ignores non-sql files", () => {
    expect(pendingMigrations(["001_a.sql", "README.md", ".DS_Store"], [])).toEqual(["001_a.sql"]);
  });
});
