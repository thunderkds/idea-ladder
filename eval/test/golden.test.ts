import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { confidenceScore } from "../src/confidence.ts";
import { GOLDEN_DIR, checkGolden, loadFixture, loadGolden, tierForStars } from "../src/golden.ts";
import { GoldenEntrySchema, GoldenSetSchema } from "../src/schema.ts";

const golden = loadGolden();
const fx = (name: string) => loadFixture(name);

describe("golden set schema (AC 1)", () => {
  test("repos.json parses with the zod schema and holds exactly 20 unique repos", () => {
    const parsed = GoldenSetSchema.parse(golden);
    expect(parsed).toHaveLength(20);
    expect(new Set(parsed.map((e) => e.fullName)).size).toBe(20);
  });

  test("every entry has a 40-hex sha, 3-10 core files, 3-6 concepts, checkedBy and checkedAt", () => {
    for (const e of golden) {
      expect(e.sha, e.fullName).toMatch(/^[0-9a-f]{40}$/);
      expect(e.expectedCoreFiles.length, e.fullName).toBeGreaterThanOrEqual(3);
      expect(e.expectedCoreFiles.length, e.fullName).toBeLessThanOrEqual(10);
      expect(e.expectedConcepts.length, e.fullName).toBeGreaterThanOrEqual(3);
      expect(e.expectedConcepts.length, e.fullName).toBeLessThanOrEqual(6);
      expect(e.checkedBy.length, e.fullName).toBeGreaterThan(0);
      expect(e.checkedAt, e.fullName).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  test("schema rejects bad entries", () => {
    const ok = golden[0]!;
    expect(() => GoldenEntrySchema.parse({ ...ok, sha: "abc123" })).toThrow();
    expect(() => GoldenEntrySchema.parse({ ...ok, tier: "famous" })).toThrow();
    expect(() => GoldenEntrySchema.parse({ ...ok, expectedCoreFiles: ["a", "b"] })).toThrow();
    expect(() => GoldenEntrySchema.parse({ ...ok, expectedConcepts: ["a", "b", "c", "d", "e", "f", "g"] })).toThrow();
    expect(() => GoldenEntrySchema.parse({ ...ok, expectedConfidence: "certain" })).toThrow();
    expect(() => GoldenEntrySchema.parse({ ...ok, fullName: "no-slash" })).toThrow();
  });

  test("core file paths are unique inside an entry", () => {
    for (const e of golden) expect(new Set(e.expectedCoreFiles).size, e.fullName).toBe(e.expectedCoreFiles.length);
  });
});

describe("golden set mix (AC 2)", () => {
  test(">= 5 repos per tier", () => {
    for (const tier of ["trending", "medium", "lowkey"] as const) {
      expect(golden.filter((e) => e.tier === tier).length, tier).toBeGreaterThanOrEqual(5);
    }
  });

  test("tier agrees with the recorded star count (trending >= 5000, medium 500-4999, lowkey < 500)", () => {
    for (const e of golden) expect(tierForStars(fx(e.fullName).stars), `${e.fullName} stars=${fx(e.fullName).stars}`).toBe(e.tier);
  });

  test(">= 4 distinct languages, and the label matches the recorded language", () => {
    expect(new Set(golden.map((e) => e.language)).size).toBeGreaterThanOrEqual(4);
    for (const e of golden) expect(fx(e.fullName).language, e.fullName).toBe(e.language);
  });

  test(">= 4 repos whose recorded snapshot scores low with the T001 confidence rule", () => {
    const low = golden.filter((e) => confidenceScore(fx(e.fullName)).level === "low");
    expect(low.length).toBeGreaterThanOrEqual(4);
  });

  test("expectedConfidence equals the level computed from the recorded fixture, for all 20", () => {
    for (const e of golden) expect(confidenceScore(fx(e.fullName)).level, e.fullName).toBe(e.expectedConfidence);
  });

  test("the 3 v0 repos are included", () => {
    const names = golden.map((e) => e.fullName);
    for (const n of ["The-Pocket/PocketFlow", "developit/mitt", "lukeed/dset"]) expect(names).toContain(n);
  });

  test("at least one repo has a non-main default branch (lukeed/dset: master)", () => {
    expect(fx("lukeed/dset").defaultBranch).toBe("master");
  });
});

describe("labels against fixtures (AC 1, AC 8)", () => {
  test("every expectedCoreFiles path exists in its fixture tree as a file; sha and name match the fixture", () => {
    expect(checkGolden(golden, fx)).toEqual([]);
  });

  test("a core path absent from the tree fails, naming the repo and the path", () => {
    const bad = structuredClone(golden);
    bad[0]!.expectedCoreFiles[0] = "src/does/not/exist.ts";
    const errors = checkGolden(bad, fx);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(bad[0]!.fullName);
    expect(errors[0]).toContain("src/does/not/exist.ts");
  });

  test("path labels are case-sensitive: readme.md does not match README.md", () => {
    const bad = structuredClone(golden);
    const mitt = bad.find((e) => e.fullName === "developit/mitt")!;
    mitt.expectedCoreFiles[0] = "SRC/index.ts";
    const errors = checkGolden(bad, fx);
    expect(errors.some((m) => m.includes("developit/mitt") && m.includes("SRC/index.ts"))).toBe(true);
  });

  test("a directory is not accepted as a core file", () => {
    const bad = structuredClone(golden);
    const mitt = bad.find((e) => e.fullName === "developit/mitt")!;
    mitt.expectedCoreFiles[0] = "src";
    expect(checkGolden(bad, fx).some((m) => m.includes("src"))).toBe(true);
  });

  test("a wrong sha is reported", () => {
    const bad = structuredClone(golden);
    bad[1]!.sha = "0".repeat(40);
    expect(checkGolden(bad, fx).some((m) => m.includes(bad[1]!.fullName) && m.includes("sha"))).toBe(true);
  });
});

describe("notes and fixture files", () => {
  test("every repo has a notes file that names each core file", () => {
    for (const e of golden) {
      const p = join(GOLDEN_DIR, "notes", `${e.fullName.replace("/", "__")}.md`);
      expect(existsSync(p), p).toBe(true);
      const text = readFileSync(p, "utf8");
      for (const f of e.expectedCoreFiles) expect(text, `${e.fullName} ${f}`).toContain(`\`${f}\``);
    }
  });

  test("fixtures hold no GitHub token", () => {
    const dir = join(GOLDEN_DIR, "fixtures");
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files).toHaveLength(20);
    for (const f of files) {
      const text = readFileSync(join(dir, f), "utf8");
      expect(text, f).not.toMatch(/gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/);
    }
  });

  test("tree truncation is recorded as a boolean on every fixture", () => {
    for (const e of golden) expect(typeof fx(e.fullName).treeTruncated, e.fullName).toBe("boolean");
  });
});
