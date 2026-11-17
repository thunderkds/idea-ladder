// T006 AC 6 / AC 9: the reader's cost entries as cost-log lines (one file per job). claude-code logs usd: null;
// api prices every call and throws for a model with no price (never usd: 0).
import { type LogOptions, logStepCost } from "../../eval/src/cost.ts";
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
