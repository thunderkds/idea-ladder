import { describe, expect, it } from "vitest";
import { conceptSlug, scoreConcepts, scoreCoreFiles } from "../src/score.js";

describe("scoreCoreFiles (AC 4)", () => {
  it("scores the guide example: recall 0.5, precision 0.5", () => {
    expect(scoreCoreFiles(["a.ts", "b.ts"], ["a.ts", "c.ts"])).toEqual({
      recall: 0.5, precision: 0.5, missed: ["c.ts"], extra: ["b.ts"],
    });
  });
  it("empty predicted gives precision 0 and recall 0, never NaN", () => {
    const s = scoreCoreFiles([], ["a.ts"]);
    expect(s).toEqual({ recall: 0, precision: 0, missed: ["a.ts"], extra: [] });
  });
  it("empty expected gives recall 0, never NaN", () => {
    const s = scoreCoreFiles(["a.ts"], []);
    expect(s.recall).toBe(0);
    expect(Number.isNaN(s.precision)).toBe(false);
  });
  it("path match is case-sensitive", () => {
    const s = scoreCoreFiles(["readme.md"], ["README.md"]);
    expect(s.recall).toBe(0);
    expect(s.missed).toEqual(["README.md"]);
    expect(s.extra).toEqual(["readme.md"]);
  });
  it("duplicates in predicted do not inflate precision", () => {
    expect(scoreCoreFiles(["a.ts", "a.ts"], ["a.ts"])).toMatchObject({ recall: 1, precision: 1, extra: [] });
  });
});

describe("scoreConcepts (AC 4)", () => {
  it("matches by normalised slug: 'Rust async' equals 'rust-async'", () => {
    expect(conceptSlug("Rust async")).toBe("rust-async");
    expect(scoreConcepts(["Rust async"], ["rust-async"])).toEqual({ overlap: 1, missed: [], extra: [] });
  });
  it("DECISION: a plural matches its singular ('embeddings' = 'embedding')", () => {
    expect(scoreConcepts(["embeddings"], ["embedding"]).overlap).toBe(1);
  });
  it("a different word is a miss and is listed", () => {
    expect(scoreConcepts(["caching", "x"], ["event-emitter", "caching"])).toEqual({
      overlap: 0.5, missed: ["event-emitter"], extra: ["x"],
    });
  });
  it("empty predicted gives overlap 0", () => {
    expect(scoreConcepts([], ["a"]).overlap).toBe(0);
  });
});
