import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { confidenceScore } from "../src/confidence.js";
import { FIXTURE_DIR, loadSnapshot } from "../src/fixtures.js";
import { checkGolden, goldenEntrySchema, goldenFileSchema, type GoldenEntry } from "../src/schema.js";

const goldenUrl = new URL("../golden/repos.json", import.meta.url);
const raw = JSON.parse(await readFile(goldenUrl, "utf8")) as unknown;
const golden = goldenFileSchema.parse(raw);
const snaps = new Map(await Promise.all(golden.map(async (e) => [e.fullName, await loadSnapshot(e.fullName)] as const)));
const loader = (n: string) => snaps.get(n);

describe("golden set (AC 1, 2)", () => {
  it("has exactly 20 entries and every entry passes the schema", () => {
    expect(golden).toHaveLength(20);
    expect(new Set(golden.map((e) => e.fullName)).size).toBe(20);
  });
  it("has no problems against the recorded fixtures", () => {
    expect(checkGolden(golden, loader)).toEqual([]);
  });
  it("mix: >= 5 per tier, >= 4 languages, >= 4 low-confidence, v0 repos included", () => {
    for (const t of ["trending", "medium", "lowkey"] as const) expect(golden.filter((e) => e.tier === t).length).toBeGreaterThanOrEqual(5);
    expect(new Set(golden.map((e) => e.language)).size).toBeGreaterThanOrEqual(4);
    const low = golden.filter((e) => confidenceScore(snaps.get(e.fullName)!).level === "low");
    expect(low.length).toBeGreaterThanOrEqual(4);
    for (const v0 of ["The-Pocket/PocketFlow", "developit/mitt", "lukeed/dset"]) expect(golden.map((e) => e.fullName)).toContain(v0);
  });
  it("expectedConfidence equals the T001 rule on the recorded snapshot", () => {
    for (const e of golden) expect([e.fullName, confidenceScore(snaps.get(e.fullName)!).level]).toEqual([e.fullName, e.expectedConfidence]);
  });
  it("records at least one repo with a monorepo-style tree (packages/ dir) and keeps the pinned sha", () => {
    expect(golden.some((e) => snaps.get(e.fullName)!.tree.some((p) => p.startsWith("packages/")))).toBe(true);
  });
  it("fixture files carry no token: only rate-limit headers are stored", async () => {
    for (const f of await readdir(FIXTURE_DIR)) {
      const text = await readFile(new URL(f, FIXTURE_DIR), "utf8");
      expect(text).not.toMatch(/ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|gho_[A-Za-z0-9]{20,}/);
      const fx = JSON.parse(text) as { entries: Record<string, { headers: Record<string, string> }> };
      for (const e of Object.values(fx.entries)) for (const h of Object.keys(e.headers)) expect(h).toMatch(/^x-ratelimit-/);
    }
  });
});

const good: GoldenEntry = {
  fullName: "o/n", sha: "b".repeat(40), tier: "lowkey", language: "C", expectedCoreFiles: ["a.c", "b.c", "c.h"],
  expectedConcepts: ["x", "y", "z"], expectedConfidence: "low", checkedBy: "qa-expert", checkedAt: "2026-11-01",
};
const snap = (tree: string[], sha = good.sha) => ({ sha, tree }) as never;

describe("golden schema negatives (AC 1, 8)", () => {
  it("a core path absent from the tree names the repo and the path", () => {
    const problems = checkGolden([{ ...good, expectedCoreFiles: ["a.c", "b.c", "missing/file.c"] }], () => snap(["a.c", "b.c", "c.h"]));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("o/n");
    expect(problems[0]).toContain("missing/file.c");
  });
  it("path case is checked exactly", () => {
    expect(checkGolden([good], () => snap(["A.c", "b.c", "c.h"]))[0]).toContain("a.c");
  });
  it("a sha that differs from the fixture sha is a problem", () => {
    expect(checkGolden([good], () => snap(["a.c", "b.c", "c.h"], "c".repeat(40)))[0]).toMatch(/sha/);
  });
  it("a missing fixture is a problem", () => {
    expect(checkGolden([good], () => undefined)[0]).toMatch(/fixture/);
  });
  it.each([
    ["short sha", { sha: "abc" }],
    ["upper-case sha", { sha: "B".repeat(40) }],
    ["2 core files", { expectedCoreFiles: ["a", "b"] }],
    ["11 core files", { expectedCoreFiles: Array.from({ length: 11 }, (_, i) => `f${i}`) }],
    ["2 concepts", { expectedConcepts: ["a", "b"] }],
    ["7 concepts", { expectedConcepts: ["a", "b", "c", "d", "e", "f", "g"] }],
    ["bad tier", { tier: "famous" }],
    ["bad confidence", { expectedConfidence: "none" }],
    ["empty checkedBy", { checkedBy: "" }],
    ["duplicate core file", { expectedCoreFiles: ["a", "a", "b"] }],
  ])("schema rejects %s", (_n, patch) => {
    expect(goldenEntrySchema.safeParse({ ...good, ...patch }).success).toBe(false);
  });
  it("schema accepts a good entry", () => {
    expect(goldenEntrySchema.safeParse(good).success).toBe(true);
  });
});
