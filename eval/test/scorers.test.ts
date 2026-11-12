import { describe, expect, test } from "bun:test";
import { conceptSlug, scoreConcepts, scoreCoreFiles } from "../src/scorers.ts";

describe("scoreCoreFiles (AC 4)", () => {
  test("half right: recall 0.5, precision 0.5, missed and extra named", () => {
    expect(scoreCoreFiles(["a.ts", "b.ts"], ["a.ts", "c.ts"])).toEqual({
      recall: 0.5,
      precision: 0.5,
      missed: ["c.ts"],
      extra: ["b.ts"],
    });
  });

  test("recall divides by expected, precision by predicted (different list sizes)", () => {
    const s = scoreCoreFiles(["a.ts", "b.ts", "c.ts", "d.ts"], ["a.ts", "b.ts"]);
    expect(s.recall).toBe(1);
    expect(s.precision).toBe(0.5);
    const t = scoreCoreFiles(["a.ts"], ["a.ts", "b.ts", "c.ts", "d.ts"]);
    expect(t.recall).toBe(0.25);
    expect(t.precision).toBe(1);
  });

  test("perfect prediction", () => {
    expect(scoreCoreFiles(["a.ts", "c.ts"], ["a.ts", "c.ts"])).toEqual({ recall: 1, precision: 1, missed: [], extra: [] });
  });

  test("empty predicted: precision 0 and recall 0, never NaN", () => {
    const s = scoreCoreFiles([], ["a.ts", "b.ts"]);
    expect(s).toEqual({ recall: 0, precision: 0, missed: ["a.ts", "b.ts"], extra: [] });
    expect(Number.isNaN(s.precision)).toBe(false);
  });

  test("empty expected: recall 0, never NaN", () => {
    const s = scoreCoreFiles(["a.ts"], []);
    expect(s.recall).toBe(0);
    expect(s.precision).toBe(0);
    expect(s.extra).toEqual(["a.ts"]);
  });

  test("path match is case-sensitive: README.md is not readme.md", () => {
    const s = scoreCoreFiles(["readme.md"], ["README.md"]);
    expect(s.recall).toBe(0);
    expect(s.missed).toEqual(["README.md"]);
    expect(s.extra).toEqual(["readme.md"]);
  });

  test("duplicate predictions count once", () => {
    const s = scoreCoreFiles(["a.ts", "a.ts", "b.ts"], ["a.ts"]);
    expect(s.precision).toBe(0.5);
    expect(s.extra).toEqual(["b.ts"]);
  });
});

describe("scoreConcepts (AC 4)", () => {
  test("conceptSlug: 'Rust async' and 'rust-async' are one slug", () => {
    expect(conceptSlug("Rust async")).toBe(conceptSlug("rust-async"));
    expect(conceptSlug("  Rust   Async! ")).toBe("rust-async");
  });

  test("decision: a plural token matches its singular ('embeddings' = 'embedding')", () => {
    expect(conceptSlug("embeddings")).toBe(conceptSlug("embedding"));
    expect(scoreConcepts(["embeddings"], ["embedding"]).overlap).toBe(1);
  });

  test("decision: 'ss' endings are not stripped ('class' stays 'class')", () => {
    expect(conceptSlug("class")).toBe("class");
    expect(conceptSlug("classes")).not.toBe(conceptSlug("class"));
  });

  test("overlap is Jaccard: |match| / |union|; missed and extra use the original expected / predicted text", () => {
    const s = scoreConcepts(["Rust async", "tokio", "macros"], ["rust-async", "tokio", "lifetimes"]);
    expect(s.overlap).toBe(0.5); // 2 shared / 4 distinct
    expect(s.missed).toEqual(["lifetimes"]);
    expect(s.extra).toEqual(["macros"]);
  });

  test("empty predicted: overlap 0, all expected missed", () => {
    expect(scoreConcepts([], ["a", "b"])).toEqual({ overlap: 0, missed: ["a", "b"], extra: [] });
  });

  test("both empty: overlap 0, never NaN", () => {
    expect(scoreConcepts([], []).overlap).toBe(0);
  });
});
