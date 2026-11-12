// T006: the repo reader as an eval subject. The factory takes the model, file access and cost logger, so tests
// run it offline with a mock model; `src/subjects/repo-reader.ts` wires the real model A and GitHub.
import type { LanguageModel } from "ai";
import { type CallUsage, pickCoreFiles, type ReadFile, type ReaderLimits } from "../../src/server/repo-reader.ts";
import type { Fixture } from "./schema.ts";
import type { MeasuredSubject, RunStats } from "./subject.ts";

/** Pre-registered in tasks/TASK_GUIDE_T006.md before the first run. Do not tune after a run. */
export const THRESHOLDS = { minMeanRecall: 0.6, minLiftOverBaseline: 0.1, maxHitLimitRuns: 4 } as const;

export function verdicts(
  report: { mean: { recall: number }; rows: { hitLimit?: boolean }[] },
  baselineMeanRecall: number,
): string[] {
  const recall = report.mean.recall;
  const floor = Math.max(THRESHOLDS.minMeanRecall, baselineMeanRecall + THRESHOLDS.minLiftOverBaseline);
  const hits = report.rows.filter((r) => r.hitLimit).length;
  return [
    `Verdict mean recall: ${recall >= floor ? "PASS" : "FAIL — own reader below threshold"} (${recall.toFixed(2)}; needs >= ${THRESHOLDS.minMeanRecall.toFixed(2)} and >= baseline ${baselineMeanRecall.toFixed(2)} + ${THRESHOLDS.minLiftOverBaseline.toFixed(2)})`,
    `Verdict runs that hit the step cap or budget: ${hits <= THRESHOLDS.maxHitLimitRuns ? "PASS" : "FAIL"} (${hits} of ${report.rows.length}; needs <= ${THRESHOLDS.maxHitLimitRuns})`,
    "Verdict mean cost per run: reported only (no cap until T017)",
  ];
}

export interface RepoReaderDeps {
  model: LanguageModel;
  limits: ReaderLimits;
  readFile: (fx: Fixture) => ReadFile;
  /** Logs one model call for one repo; returns its USD cost. */
  logCost: (fx: Fixture, usage: CallUsage) => number;
}

export function createRepoReaderSubject(deps: RepoReaderDeps): MeasuredSubject {
  const stats = new Map<string, RunStats>();
  return {
    name: "repo-reader",
    async coreFiles(fx) {
      const s: RunStats = { modelCalls: 0, usd: 0, hitLimit: false };
      stats.set(fx.fullName, s);
      const result = await pickCoreFiles({
        repo: fx.fullName,
        sha: fx.sha,
        tree: fx.tree,
        treeTruncated: fx.treeTruncated,
        model: deps.model,
        limits: deps.limits,
        readFile: deps.readFile(fx),
        onUsage: (u) => {
          s.modelCalls++;
          s.usd += deps.logCost(fx, u);
        },
      });
      s.hitLimit = result.hitLimit;
      return result.coreFiles.map((f) => f.path);
    },
    runStats: (fullName) => stats.get(fullName),
    verdicts,
  };
}
