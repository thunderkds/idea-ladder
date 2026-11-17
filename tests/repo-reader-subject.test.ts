// T006 AC 7 (offline part): the repo-reader eval subject runs pickCoreFiles on golden fixtures and the report
// carries per-repo recall/precision, mean cost, mean model calls, limit hits, the baseline and the verdict lines.
// The paid run on all 20 repos with model A is the owner's (tasks/TASK_REVIEW_T006.md).
import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadFixture, loadGolden } from "../eval/src/golden.ts";
import { renderMarkdown, runEval } from "../eval/src/harness.ts";
import { createRepoReaderSubject, readerLimitsFromEnv, THRESHOLDS, verdicts } from "../eval/src/repo-reader-subject.ts";
import baselineReadme from "../eval/src/subjects/baseline-readme.ts";
import { RateLimitError } from "../src/server/github-repo.ts";
import { answer, scriptedModel } from "./support/mock-model.ts";

const repos = loadGolden().slice(0, 3);

describe("repo-reader eval subject (AC 7, offline with a mock model)", () => {
  test("report rows carry recall, precision, model calls, USD and limit hits; markdown shows baseline + verdicts", async () => {
    // Each repo: answer with its first expected core files plus fillers from the tree, without tool calls.
    const model = scriptedModel((_, options) => {
      const user = JSON.stringify(options.prompt);
      const entry = repos.find((r) => user.includes(`Repository ${r.fullName} `));
      if (!entry) throw new Error("unknown repo in prompt");
      const blobs = loadFixture(entry.fullName)
        .tree.filter((t) => t.type === "blob")
        .map((t) => t.path);
      const paths = [...new Set([...entry.expectedCoreFiles.slice(0, 2), ...blobs])].slice(0, 3);
      return { text: answer(paths.map((path) => ({ path }))) };
    });
    const logged: string[] = [];
    const subject = createRepoReaderSubject({
      model,
      limits: { maxSteps: 15, tokenBudget: 80_000 },
      readFile: () => async () => "",
      logCost: (fx, u) => {
        logged.push(`${fx.fullName}:${u.model}:${u.inputTokens}+${u.outputTokens}`);
        return 0.0045;
      },
    });
    const report = await runEval({ step: "core-files", subject, repos, loadFixture });
    const baseline = await runEval({ step: "core-files", subject: baselineReadme, repos, loadFixture });
    report.baseline = { subject: "baseline-readme", meanRecall: baseline.mean.recall };
    report.verdicts = subject.verdicts(report, baseline.mean.recall);

    expect(report.rows.length).toBe(3);
    for (const r of report.rows) {
      expect(r.error).toBeUndefined();
      expect(r).toMatchObject({ modelCalls: 1, usd: 0.0045, hitLimit: false, githubRateLimited: 0 });
      expect(r.recall).toBeGreaterThan(0);
    }
    expect(report.mean.usd).toBeCloseTo(0.0045, 10);
    expect(report.mean.modelCalls).toBe(1);
    expect(report.hitLimitRuns).toBe(0);
    expect(report.githubRateLimited).toBe(0);
    expect(logged).toEqual(repos.map((r) => `${r.fullName}:test-model:100+10`));
    const md = renderMarkdown(report);
    expect(md).toContain("| Model calls | USD | Hit limit | GitHub rate-limited |");
    expect(md).toContain("0 of 3");
    expect(md).toContain("Baseline `baseline-readme` mean recall:");
    expect(md).toContain("Verdict mean recall:");
    expect(md).toContain("Verdict runs that hit the step cap or budget: PASS (0 of 3; needs <= 4)");
  });

  test("github-rate-limited reads are reported per repo and as a total, so a rate-limited repo is not read as a reader miss", async () => {
    const [first, second] = repos;
    if (!first || !second) throw new Error("no golden repos");
    const blobs = (name: string) =>
      loadFixture(name)
        .tree.filter((t) => t.type === "blob")
        .map((t) => t.path);
    const model = scriptedModel((call, options) => {
      const user = JSON.stringify(options.prompt);
      const entry = [first, second].find((r) => user.includes(`Repository ${r.fullName} `));
      if (!entry) throw new Error("unknown repo in prompt");
      const path = blobs(entry.fullName)[0] as string;
      const done = user.includes("tool-result");
      return done || call % 3 === 2
        ? {
            text: answer(
              blobs(entry.fullName)
                .slice(0, 3)
                .map((p) => ({ path: p })),
            ),
          }
        : { tools: [{ name: "read", input: { path } }] };
    });
    const subject = createRepoReaderSubject({
      model,
      limits: { maxSteps: 15, tokenBudget: 80_000 },
      // Only the first repo is rate limited.
      readFile: (fx) => async () => {
        if (fx.fullName === first.fullName) throw new RateLimitError(new Date(2_000_000_000_000));
        return "x";
      },
      logCost: () => 0.001,
    });
    const report = await runEval({ step: "core-files", subject, repos: [first, second], loadFixture });
    expect(report.rows.map((r) => r.githubRateLimited)).toEqual([1, 0]);
    expect(report.githubRateLimited).toBe(1);
    const md = renderMarkdown(report);
    expect(md).toContain("| GitHub rate-limited |");
    expect(md.split("\n").find((l) => l.startsWith("| **mean**"))).toEndWith("| 1 |"); // the total
  });

  test("verdicts apply the pre-registered thresholds: recall >= 0.60 AND >= baseline + 0.10; <= 4 limit hits", () => {
    expect(THRESHOLDS).toEqual({ minMeanRecall: 0.6, minLiftOverBaseline: 0.1, maxHitLimitRuns: 4 });
    const rows = (hits: number) => Array.from({ length: 20 }, (_, i) => ({ hitLimit: i < hits }));
    expect(verdicts({ mean: { recall: 0.6 }, rows: rows(4) }, 0.06)[0]).toStartWith("Verdict mean recall: PASS");
    expect(verdicts({ mean: { recall: 0.59 }, rows: rows(0) }, 0.06)[0]).toContain("FAIL — own reader below threshold");
    expect(verdicts({ mean: { recall: 0.7 }, rows: rows(0) }, 0.65)[0]).toContain("FAIL"); // lift 0.05 < 0.10
    expect(verdicts({ mean: { recall: 0.7 }, rows: rows(4) }, 0.06)[1]).toContain("PASS (4 of 20");
    expect(verdicts({ mean: { recall: 0.7 }, rows: rows(5) }, 0.06)[1]).toContain("FAIL (5 of 20");
  });

  test("a reader error on one repo is a scored miss on its row, with its stats kept", async () => {
    const model = scriptedModel(() => ({ text: "no idea" }));
    const subject = createRepoReaderSubject({
      model,
      limits: { maxSteps: 15, tokenBudget: 80_000 },
      readFile: () => async () => "",
      logCost: () => 0.001,
    });
    const report = await runEval({ step: "core-files", subject, repos: repos.slice(0, 1), loadFixture });
    expect(report.rows[0]).toMatchObject({ recall: 0, modelCalls: 2, usd: 0.002, hitLimit: false });
    expect(report.rows[0]?.error).toContain("reader-invalid-output");
  });

  test("a run that hits the step cap and then fails with reader-invalid-output counts as a limit hit", async () => {
    const model = scriptedModel((_, o) =>
      o.toolChoice?.type === "none" ? { text: "no idea" } : { tools: [{ name: "list", input: { path: "" } }] },
    );
    const subject = createRepoReaderSubject({
      model,
      limits: { maxSteps: 2, tokenBudget: 80_000 },
      readFile: () => async () => "",
      logCost: () => 0.001,
    });
    const report = await runEval({ step: "core-files", subject, repos: repos.slice(0, 1), loadFixture });
    expect(report.rows[0]?.error).toContain("reader-invalid-output");
    expect(report.rows[0]).toMatchObject({ recall: 0, modelCalls: 4, hitLimit: true }); // 2 steps + final + repair
    expect(report.hitLimitRuns).toBe(1);
  });

  test("READER_MAX_STEPS / READER_TOKEN_BUDGET: defaults, and NaN, 0 or too large is refused", () => {
    expect(readerLimitsFromEnv({})).toEqual({ maxSteps: 15, tokenBudget: 80_000 });
    expect(readerLimitsFromEnv({ READER_MAX_STEPS: "20", READER_TOKEN_BUDGET: "100000" })).toEqual({
      maxSteps: 20,
      tokenBudget: 100_000,
    });
    for (const bad of ["abc", "0", "-1", "1.5", "51"])
      expect(() => readerLimitsFromEnv({ READER_MAX_STEPS: bad })).toThrow(
        "READER_MAX_STEPS must be a positive integer",
      );
    expect(() => readerLimitsFromEnv({ READER_TOKEN_BUDGET: "500001" })).toThrow("at most 500000");
  });
});

describe("repo-reader eval subject on the claude-code back end (AC 9)", () => {
  test("no API key or price needed; usd null; the report shows n/a (subscription) plus tokens", async () => {
    const rec = await mkdtemp(join(tmpdir(), "il-fake-claude-"));
    const bin = join(rec, "claude");
    await writeFile(
      bin,
      `#!/bin/sh\nexec "${process.execPath}" "${join(import.meta.dir, "support", "fake-claude.ts")}" "${rec}" "$@"\n`,
    );
    await chmod(bin, 0o755);
    const [entry] = repos;
    if (!entry) throw new Error("no golden repo");
    const blobs = loadFixture(entry.fullName)
      .tree.filter((t) => t.type === "blob")
      .map((t) => t.path);
    const coreFiles = blobs.slice(0, 3).map((path) => ({ path, reason: "core" }));
    const usage = { input_tokens: 40, output_tokens: 10, cache_read_input_tokens: 50, cache_creation_input_tokens: 0 };
    const out = { is_error: false, num_turns: 5, session_id: "s", structured_output: { coreFiles }, usage };
    await writeFile(join(rec, "replies.json"), JSON.stringify([{ stdout: JSON.stringify(out), toolCalls: 4 }]));
    const subject = createRepoReaderSubject({
      claudeCode: { claudeBin: bin },
      limits: { maxSteps: 15, tokenBudget: 80_000 },
      logCost: () => null,
    });
    const report = await runEval({ step: "core-files", subject, repos: [entry], loadFixture });
    expect(report.rows[0]).toMatchObject({ predicted: blobs.slice(0, 3), modelCalls: 5, usd: null, tokens: 100 });
    expect(report.mean.usd).toBeNull();
    const md = renderMarkdown(report);
    expect(md).toContain("n/a (subscription), 100 tokens");
    expect(md).not.toContain("0.0000");
    await rm(rec, { recursive: true, force: true });
  });
});
