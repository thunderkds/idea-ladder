import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runEval, renderMarkdown, writeReport } from "../src/harness.js";
import type { GoldenEntry } from "../src/schema.js";
import type { RepoSnapshot } from "../src/github.js";
import { subject as baseline } from "../src/subjects/baseline-readme.js";

const snap = (o: Partial<RepoSnapshot>): RepoSnapshot => ({
  fullName: "o/a", sha: "a".repeat(40), defaultBranch: "main", readme: "", readmePath: "README.md", topics: [], languages: {},
  depFiles: [], depFileContents: {}, tree: [], treeTruncated: false, openIssues: 0, goodFirstIssues: 0, ...o,
});
const entry = (fullName: string, core: string[]): GoldenEntry => ({
  fullName, sha: "a".repeat(40), tier: "medium", language: "JavaScript", expectedCoreFiles: core, expectedConcepts: ["a", "b", "c"],
  expectedConfidence: "high", checkedBy: "qa-expert", checkedAt: "2026-11-01",
});
const snaps: Record<string, RepoSnapshot> = {
  "o/a": snap({ fullName: "o/a", readme: "See `src/index.js` and utils.js. Also ghost.js and README.md.", tree: ["README.md", "package.json", "src/index.js", "lib/utils.js", "lib/other/dup.js", "test/dup.js"], depFiles: ["package.json"], depFileContents: { "package.json": '{"main":"./lib/utils.js"}' } }),
  "o/b": snap({ fullName: "o/b", readme: "nothing named here", tree: ["README.md", "x.rs"], topics: ["parser", "cli"] }),
};

describe("baseline-readme subject (AC 5)", () => {
  it("names files from the README that exist in the tree + the package.json entry point", async () => {
    const out = await baseline.run(snaps["o/a"]!);
    expect(out.coreFiles).toEqual(expect.arrayContaining(["src/index.js", "lib/utils.js"]));
    expect(out.coreFiles).not.toContain("ghost.js");
    expect(new Set(out.coreFiles).size).toBe(out.coreFiles!.length);
  });
  it("a bare name that matches two tree files is ambiguous and skipped", async () => {
    const out = await baseline.run(snap({ readme: "see dup.js", tree: ["lib/other/dup.js", "test/dup.js"] }));
    expect(out.coreFiles).toEqual([]);
  });
  it("images and docs named in the README are not core files", async () => {
    const out = await baseline.run(snap({ readme: "![x](logo.png) see CONTRIBUTING.md and src/a.js", tree: ["logo.png", "CONTRIBUTING.md", "src/a.js"] }));
    expect(out.coreFiles).toEqual(["src/a.js"]);
  });
  it("a README that names nothing gives an empty list, not an error", async () => {
    expect((await baseline.run(snaps["o/b"]!)).coreFiles).toEqual([]);
  });
  it("concepts come from topics", async () => {
    expect((await baseline.run(snaps["o/b"]!)).concepts).toEqual(["parser", "cli"]);
  });
});

describe("harness (AC 4)", () => {
  const entries = [entry("o/a", ["src/index.js", "lib/utils.js", "lib/x.js"]), entry("o/b", ["x.rs", "y.rs", "z.rs"])];
  const load = async (n: string) => snaps[n]!;
  it("scores every repo and reports means (2-repo subset)", async () => {
    const r = await runEval({ step: "core-files", subject: baseline, subjectName: "baseline-readme", repos: entries, loadSnapshot: load, now: () => new Date("2026-11-01T00:00:00Z") });
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]!.recall).toBeCloseTo(2 / 3);
    expect(r.rows[1]!.recall).toBe(0);
    expect(r.mean.recall).toBeCloseTo(1 / 3);
    expect(Number.isNaN(r.mean.precision)).toBe(false);
  });
  it("writes <step>-<timestamp>.json and .md with one row per repo", async () => {
    const r = await runEval({ step: "core-files", subject: baseline, subjectName: "baseline-readme", repos: entries, loadSnapshot: load, now: () => new Date("2026-11-01T00:00:00Z") });
    const dir = await mkdtemp(join(tmpdir(), "rep-"));
    const files = await writeReport(r, dir);
    expect((await readdir(dir)).sort()).toEqual(["core-files-2026-11-01T00-00-00.000Z.json", "core-files-2026-11-01T00-00-00.000Z.md"]);
    expect(JSON.parse(await readFile(files.json, "utf8")).rows).toHaveLength(2);
    const md = renderMarkdown(r);
    expect(md).toContain("| o/a |");
    expect(md).toContain("| o/b |");
    expect(md).toMatch(/mean/i);
  });
  it("concepts step works", async () => {
    const r = await runEval({ step: "concepts", subject: baseline, subjectName: "baseline-readme", repos: entries, loadSnapshot: load });
    expect(r.rows.every((x) => typeof x.overlap === "number")).toBe(true);
  });
  it("a subject that returns nothing for the step is an error naming the repo", async () => {
    const bad = { name: "bad", run: async () => ({}) };
    await expect(runEval({ step: "core-files", subject: bad, subjectName: "bad", repos: entries, loadSnapshot: load })).rejects.toThrow(/o\/a/);
  });
});
