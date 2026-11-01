// Golden-set subject for the T006 repo reader: the real tool loop on model A, live model calls.
// The tree comes from the replayed fixture; file contents are read live from raw.githubusercontent.com at the pinned SHA.
// Needs ANTHROPIC_API_KEY and MODEL_A_ID, and a price for that model in prices.json (never log usd 0 for it).
// The subject never reads the golden labels; scoring happens in the harness.
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import { pickCoreFiles, readerLimitsFromEnv, STEP_NAME, type PickCoreFilesResult, type ReaderCostSink, type ReaderLimits } from "../../../src/reader/repo-reader.js";
import { decodeFile, type RepoFile } from "../../../src/reader/repo-tools.js";
import { logStepCost, readCostLog } from "../cost.js";
import type { RepoSnapshot } from "../github.js";
import { runEval, type Report, type RunOptions, type Subject } from "../harness.js";
import subjectBaseline from "./baseline-readme.js";

export interface RunStat {
  fullName: string;
  steps: number;
  toolCalls: number;
  modelCalls: number;
  totalTokens: number;
  usd: number;
  stoppedBy: PickCoreFilesResult["stoppedBy"];
}

/** Thresholds fixed before the first run (tasks/TASK_GUIDE_T006.md § Pre-registered thresholds). Do not tune. */
export const THRESHOLDS = { minRecall: 0.6, minRecallOverBaseline: 0.1, maxCapOrBudgetRuns: 4 } as const;

const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const f3 = (n: number) => n.toFixed(3);

export function rawFileReader(fullName: string, sha: string, fetchImpl: typeof fetch = fetch) {
  return async (path: string): Promise<RepoFile> => {
    const url = `https://raw.githubusercontent.com/${fullName}/${sha}/${path.split("/").map(encodeURIComponent).join("/")}`;
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`GitHub raw ${res.status} for ${url}`);
    return decodeFile(new Uint8Array(await res.arrayBuffer()));
  };
}

export interface SubjectDeps {
  model?: LanguageModel;
  limits?: ReaderLimits;
  fetchImpl?: typeof fetch;
  /** Replaces the cost log (tests). The default is logStepCost into cost-log/<runId>.jsonl. */
  logCost?: (runKey: string) => ReaderCostSink;
  runId?: string;
}

/** `stats` fills as the harness runs the repos one by one. */
export function createRepoReaderSubject(deps: SubjectDeps = {}): Subject & { stats: RunStat[]; runId: string } {
  const runId = deps.runId ?? `repo-reader-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const stats: RunStat[] = [];
  let model = deps.model;
  const limits = deps.limits ?? readerLimitsFromEnv(process.env);
  return {
    name: "repo-reader",
    stats,
    runId,
    async run(s: RepoSnapshot) {
      if (!model) {
        const key = process.env.ANTHROPIC_API_KEY;
        const id = process.env.MODEL_A_ID;
        if (!key || !id) throw new Error("repo-reader needs ANTHROPIC_API_KEY and MODEL_A_ID in the environment (a live, paid run)");
        model = createAnthropic({ apiKey: key })(id);
      }
      const ladderKey = `${s.fullName}@${s.sha}`;
      const before = (await readCostLog(runId)).filter((r) => r.ladderKey === ladderKey).length;
      const logCost: ReaderCostSink = deps.logCost
        ? deps.logCost(ladderKey)
        : (call) => logStepCost({ runId, ladderKey, step: STEP_NAME, ...call });
      const r = await pickCoreFiles({ repo: s.fullName, sha: s.sha, tree: s.tree, readFile: rawFileReader(s.fullName, s.sha, deps.fetchImpl), model, limits, logCost });
      const usd = (await readCostLog(runId)).filter((x) => x.ladderKey === ladderKey).slice(before).reduce((n, x) => n + x.usd, 0);
      stats.push({ fullName: s.fullName, steps: r.steps, toolCalls: r.toolCalls, modelCalls: r.modelCalls, totalTokens: r.totalTokens, usd, stoppedBy: r.stoppedBy });
      return { coreFiles: r.coreFiles.map((c) => c.path), concepts: s.topics };
    },
  };
}

/** Pure: the comparison with the baseline, the cost/steps means and one verdict line per pre-registered threshold. */
export function summarizeReader(report: Report, baseline: Report, stats: RunStat[]): string {
  const n = report.repoCount;
  const byName = new Map(stats.map((x) => [x.fullName, x]));
  const baseByName = new Map(baseline.rows.map((r) => [r.fullName, r]));
  const rows = report.rows.map((r) => {
    const st = byName.get(r.fullName);
    return `| ${r.fullName} | ${f3(r.recall ?? 0)} | ${f3(r.precision ?? 0)} | ${f3(baseByName.get(r.fullName)?.recall ?? 0)} | ${st?.steps ?? ""} | ${st?.totalTokens ?? ""} | ${st ? st.usd.toFixed(4) : ""} | ${st?.stoppedBy ?? ""} |`;
  });
  const meanRecall = report.mean.recall ?? 0;
  const baseRecall = baseline.mean.recall ?? 0;
  const capped = stats.filter((x) => x.stoppedBy !== "model").length;
  const recallOk = meanRecall >= THRESHOLDS.minRecall && meanRecall >= baseRecall + THRESHOLDS.minRecallOverBaseline;
  const capOk = capped <= THRESHOLDS.maxCapOrBudgetRuns;
  return [
    `# repo-reader vs baseline-readme (${n} repos)`,
    "",
    "| Repo | Recall | Precision | Baseline recall | Steps | Tokens | USD | Stopped by |",
    "|---|---|---|---|---|---|---|---|",
    ...rows,
    "",
    `Mean recall ${f3(meanRecall)} (baseline-readme ${f3(baseRecall)}); mean precision ${f3(report.mean.precision ?? 0)}`,
    `Mean steps ${mean(stats.map((x) => x.steps)).toFixed(2)}; mean tokens ${Math.round(mean(stats.map((x) => x.totalTokens)))}; mean cost USD ${mean(stats.map((x) => x.usd)).toFixed(4)}`,
    "",
    `VERDICT recall: ${recallOk ? "KEEP own reader" : "own reader below threshold"} — mean recall ${f3(meanRecall)} needs >= ${THRESHOLDS.minRecall} and >= baseline ${f3(baseRecall)} + ${THRESHOLDS.minRecallOverBaseline}`,
    `VERDICT step cap / budget: ${capOk ? "within limit" : "over limit"} — ${capped} of ${n} runs hit the step cap or token budget (limit ${THRESHOLDS.maxCapOrBudgetRuns})`,
    `VERDICT cost: reported only — mean USD ${mean(stats.map((x) => x.usd)).toFixed(4)} per run`,
    "",
  ].join("\n");
}

const live = createRepoReaderSubject();
export const subject: Subject = live;
export default subject;

/** Called by `pnpm eval` after the harness report: reruns the offline baseline on the same snapshots and prints the comparison. */
export async function summarize(report: Report, ctx: Pick<RunOptions, "repos" | "loadSnapshot">): Promise<string> {
  const baseline = await runEval({ step: "core-files", subject: subjectBaseline, subjectName: "baseline-readme", repos: ctx.repos, loadSnapshot: ctx.loadSnapshot });
  return summarizeReader(report, baseline, live.stats);
}
