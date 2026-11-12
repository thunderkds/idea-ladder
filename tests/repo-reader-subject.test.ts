// T006 AC 7 (offline part): the repo-reader eval subject runs pickCoreFiles on golden fixtures and the report
// carries per-repo recall/precision, mean cost, mean model calls, limit hits, the baseline and the verdict lines.
// The paid run on all 20 repos with model A is the owner's (tasks/TASK_REVIEW_T006.md).
import { describe, expect, test } from "bun:test";
import { loadFixture, loadGolden } from "../eval/src/golden.ts";
import { renderMarkdown, runEval } from "../eval/src/harness.ts";
import { createRepoReaderSubject, THRESHOLDS, verdicts } from "../eval/src/repo-reader-subject.ts";
import baselineReadme from "../eval/src/subjects/baseline-readme.ts";
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
      expect(r).toMatchObject({ modelCalls: 1, usd: 0.0045, hitLimit: false });
      expect(r.recall).toBeGreaterThan(0);
    }
    expect(report.mean.usd).toBeCloseTo(0.0045, 10);
    expect(report.mean.modelCalls).toBe(1);
    expect(report.hitLimitRuns).toBe(0);
    expect(logged).toEqual(repos.map((r) => `${r.fullName}:test-model:100+10`));
    const md = renderMarkdown(report);
    expect(md).toContain("| Model calls | USD | Hit limit |");
    expect(md).toContain("0 of 3");
    expect(md).toContain("Baseline `baseline-readme` mean recall:");
    expect(md).toContain("Verdict mean recall:");
    expect(md).toContain("Verdict runs that hit the step cap or budget: PASS (0 of 3; needs <= 4)");
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
    expect(report.rows[0]).toMatchObject({ recall: 0, modelCalls: 2, usd: 0.002 });
    expect(report.rows[0]?.error).toContain("reader-invalid-output");
  });
});
