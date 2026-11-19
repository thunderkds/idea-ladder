// T006 AC 6 / AC 9: the reader's cost entries as cost-log lines (one file per job). claude-code logs usd: null;
// api prices every call and throws for a model with no price (never usd: 0).
import {
  COST_LOG_DIR,
  type LogOptions,
  logStepCost,
  readCostLog,
  summarizeRun,
  type Totals,
} from "../../eval/src/cost.ts";
import type { ReaderDeps } from "./ladder-generate.ts";

export function readerCostLogger(opts: LogOptions = {}): ReaderDeps["logCost"] {
  return ({ jobId, repo, sha, step, model, inputTokens, outputTokens, cachedInputTokens, backend }) => {
    logStepCost(
      {
        runId: `job-${jobId}`,
        ladderKey: `${repo}@${sha}`,
        step,
        model,
        inputTokens,
        outputTokens,
        cachedInputTokens,
        backend,
      },
      opts,
    );
  };
}

/** T008 generation report: this job's cost lines per step (the file readerCostLogger writes); null if there is none. */
export function jobCostByStep(jobId: string, logDir = COST_LOG_DIR): Record<string, Totals> | null {
  try {
    return summarizeRun(readCostLog(`job-${jobId}`, logDir)).byStep;
  } catch (err) {
    console.warn(JSON.stringify({ event: "job-cost-log-unreadable", jobId, error: String(err) }));
    return null;
  }
}
