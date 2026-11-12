// T006: the repo reader as an eval subject. The factory takes the model, file access and cost logger, so tests
// run it offline with a mock model; `src/subjects/repo-reader.ts` wires the real model A and GitHub.
import type { LanguageModel } from "ai";
import { pickCoreFilesClaudeCode, ReaderFailedError } from "../../src/server/claude-code-reader.ts";
import { parsePositiveInt, READER_LIMIT_MAX } from "../../src/server/config.ts";
import {
  type CallUsage,
  type PickResult,
  pickCoreFiles,
  READER_DEFAULTS,
  type ReadFile,
  ReaderBudgetError,
  ReaderInvalidOutputError,
  type ReaderLimits,
} from "../../src/server/repo-reader.ts";
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

/** READER_MAX_STEPS / READER_TOKEN_BUDGET with the server's checks; throws before any paid call. */
export function readerLimitsFromEnv(env: Record<string, string | undefined>): ReaderLimits {
  const read = (name: string, fallback: number, max: number) => {
    const n = parsePositiveInt(env[name] || String(fallback), max);
    if (n === null) throw new Error(`${name} must be a positive integer at most ${max}`);
    return n;
  };
  return {
    maxSteps: read("READER_MAX_STEPS", READER_DEFAULTS.maxSteps, READER_LIMIT_MAX.steps),
    tokenBudget: read("READER_TOKEN_BUDGET", READER_DEFAULTS.tokenBudget, READER_LIMIT_MAX.tokens),
  };
}

export type RepoReaderDeps = {
  limits: ReaderLimits;
  /** Logs one model call for one repo; returns its USD cost, or null on the subscription (claude-code). */
  logCost: (fx: Fixture, usage: CallUsage) => number | null;
} & (
  | { model: LanguageModel; readFile: (fx: Fixture) => ReadFile }
  | { claudeCode: { modelId?: string; githubToken?: string; claudeBin?: string } }
);

export function createRepoReaderSubject(deps: RepoReaderDeps): MeasuredSubject {
  const stats = new Map<string, RunStats>();
  return {
    name: "repo-reader",
    async coreFiles(fx) {
      const s: RunStats = { modelCalls: 0, usd: 0, hitLimit: false, tokens: 0 };
      stats.set(fx.fullName, s);
      const common = { repo: fx.fullName, sha: fx.sha, tree: fx.tree, treeTruncated: fx.treeTruncated, limits: deps.limits };
      const onUsage = (u: CallUsage) => {
        s.modelCalls++;
        s.tokens = (s.tokens ?? 0) + u.inputTokens + u.cachedInputTokens + u.outputTokens;
        const usd = deps.logCost(fx, u);
        s.usd = usd === null || s.usd === null ? null : s.usd + usd;
      };
      let result: PickResult;
      try {
        result =
          "claudeCode" in deps
            ? await pickCoreFilesClaudeCode({ ...common, ...deps.claudeCode, onUsage })
            : await pickCoreFiles({ ...common, model: deps.model, readFile: deps.readFile(fx), onUsage });
      } catch (err) {
        // A run that hit the cap and then failed still counts toward the limit-hit verdict.
        if (
          err instanceof ReaderInvalidOutputError ||
          err instanceof ReaderBudgetError ||
          err instanceof ReaderFailedError
        )
          s.hitLimit = err.hitLimit;
        throw err;
      }
      // claude-code: one onUsage per `claude -p` run; model calls are the turns the CLI reports.
      if ("claudeCode" in deps) s.modelCalls = result.modelCalls;
      s.hitLimit = result.hitLimit;
      return result.coreFiles.map((f) => f.path);
    },
    runStats: (fullName) => stats.get(fullName),
    verdicts,
  };
}
