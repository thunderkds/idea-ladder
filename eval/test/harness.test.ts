import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { baselineReadme, extractReadmePaths } from "../src/subjects/baseline-readme.ts";
import { loadGolden, loadFixture } from "../src/golden.ts";
import { loadSubject, renderMarkdown, runEval, writeReport } from "../src/harness.ts";
import type { Fixture } from "../src/schema.ts";

const realFetch = globalThis.fetch;
beforeAll(() => {
  // AC 3: every harness run is offline. Any network call fails the test loudly.
  globalThis.fetch = (() => { throw new Error("network blocked in test"); }) as unknown as typeof fetch;
});
afterAll(() => { globalThis.fetch = realFetch; });

const synthetic: Fixture = {
  fullName: "o/lib",
  sha: "b".repeat(40),
  recordedAt: "2026-11-12T00:00:00.000Z",
  defaultBranch: "main",
  stars: 10,
  language: "TypeScript",
  topics: ["Event Emitter", "pubsub"],
  languages: { TypeScript: 1 },
  readme: [
    "# lib",
    "Start in `src/index.ts`, then see lib/foo.js and [core](https://github.com/o/lib/blob/main/src/core.ts).",
    "Also docs/missing.md and readme.md and README.md.",
    "Repeat: src/index.ts.",
  ].join("\n"),
  tree: [
    { path: "README.md", type: "blob" },
    { path: "package.json", type: "blob" },
    { path: "src", type: "tree" },
    { path: "src/index.ts", type: "blob" },
    { path: "src/core.ts", type: "blob" },
    { path: "src/entry.ts", type: "blob" },
    { path: "lib", type: "tree" },
    { path: "lib/foo.js", type: "blob" },
  ],
  treeTruncated: false,
  depFiles: ["package.json"],
  depFileContents: { "package.json": JSON.stringify({ main: "dist/x.js", source: "src/entry.ts" }) },
  openIssues: 1,
  goodFirstIssues: 0,
};

describe("baseline-readme subject (AC 5)", () => {
  test("files named in the README that exist in the tree, in README order, then the dependency-file entry point", () => {
    expect(baselineReadme.coreFiles(synthetic)).toEqual(["src/index.ts", "lib/foo.js", "src/core.ts", "src/entry.ts"]);
  });

  test("README paths missing from the tree are dropped; matching is case-sensitive; the README itself is not a prediction", () => {
    const paths = extractReadmePaths(synthetic.readme);
    expect(paths).toContain("docs/missing.md");
    const files = baselineReadme.coreFiles(synthetic);
    expect(files).not.toContain("docs/missing.md");
    expect(files).not.toContain("readme.md");
    expect(files).not.toContain("README.md");
  });

  test("a repo with no README and no dependency file predicts nothing (empty list, no crash)", () => {
    expect(baselineReadme.coreFiles({ ...synthetic, readme: "", depFiles: [], depFileContents: {} })).toEqual([]);
  });

  test("a malformed package.json is ignored, not thrown", () => {
    expect(baselineReadme.coreFiles({ ...synthetic, readme: "", depFileContents: { "package.json": "{not json" } })).toEqual([]);
  });

  test("baseline concepts are the repo topics", () => {
    expect(baselineReadme.concepts?.(synthetic)).toEqual(["Event Emitter", "pubsub"]);
  });
});

describe("runEval over a 2-repo fixture subset (AC 4, AC 5)", () => {
  const two = loadGolden().filter((e) => ["developit/mitt", "lukeed/dset"].includes(e.fullName));

  test("core-files: one row per repo with recall, precision, missed, extra, and a mean", async () => {
    expect(two).toHaveLength(2);
    const report = await runEval({ step: "core-files", subject: baselineReadme, repos: two, loadFixture });
    expect(report.rows).toHaveLength(2);
    for (const row of report.rows) {
      expect(row.recall).toBeGreaterThanOrEqual(0);
      expect(row.recall).toBeLessThanOrEqual(1);
      expect(Number.isNaN(row.precision)).toBe(false);
    }
    expect(report.mean.recall).toBeCloseTo((report.rows[0]!.recall + report.rows[1]!.recall) / 2, 10);
    expect(report.subject).toBe("baseline-readme");
  });

  test("concepts step runs the same way and reports overlap", async () => {
    const report = await runEval({ step: "concepts", subject: baselineReadme, repos: two, loadFixture });
    expect(report.rows).toHaveLength(2);
    expect(report.rows[0]).toHaveProperty("overlap");
  });

  test("a subject that does not implement the step fails with a clear error", async () => {
    const noConcepts = { name: "no-concepts", coreFiles: () => [] };
    await expect(runEval({ step: "concepts", subject: noConcepts, repos: two, loadFixture })).rejects.toThrow(/concepts/);
  });

  test("a subject that throws on one repo is reported on that row and the run continues", async () => {
    const flaky = { name: "flaky", coreFiles: (f: Fixture) => { if (f.fullName === "lukeed/dset") throw new Error("boom"); return []; } };
    const report = await runEval({ step: "core-files", subject: flaky, repos: two, loadFixture });
    expect(report.rows).toHaveLength(2);
    expect(report.rows.find((r) => r.fullName === "lukeed/dset")?.error).toContain("boom");
    expect(report.mean.recall).toBe(0);
  });

  test("an unknown step is rejected", async () => {
    await expect(runEval({ step: "nope" as never, subject: baselineReadme, repos: two, loadFixture })).rejects.toThrow(/step/);
  });
});

describe("report files (AC 4)", () => {
  let dir: string;
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "eval-reports-")); });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  test("writeReport writes <step>-<timestamp>.json and a Markdown summary with per-repo rows and the mean", async () => {
    const report = await runEval({ step: "core-files", subject: baselineReadme, repos: loadGolden(), loadFixture, now: () => new Date("2026-11-12T08:15:00Z") });
    const { jsonPath, mdPath } = writeReport(report, dir);
    expect(jsonPath).toMatch(/core-files-20261112T081500Z\.json$/);
    expect(existsSync(jsonPath) && existsSync(mdPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(jsonPath, "utf8"));
    expect(parsed.rows).toHaveLength(20);
    const md = readFileSync(mdPath, "utf8");
    expect(md).toContain("The-Pocket/PocketFlow");
    expect(md).toContain("mean");
    expect(md.split("\n").filter((l) => l.startsWith("| ") && l.includes("/")).length).toBe(20);
    expect(readdirSync(dir)).toHaveLength(2);
    expect(renderMarkdown(report)).toBe(md);
  });
});

describe("loadSubject", () => {
  test("resolves a bare name to src/subjects/<name>.ts", async () => {
    expect((await loadSubject("baseline-readme")).name).toBe("baseline-readme");
  });

  test("rejects a name that tries to leave the subjects folder or does not exist", async () => {
    await expect(loadSubject("../cost")).rejects.toThrow();
    await expect(loadSubject("nope-nothing")).rejects.toThrow(/subject/);
  });
});
