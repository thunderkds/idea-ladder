import type { Fixture } from "./schema.ts";

export interface RunStats { modelCalls: number; usd: number; hitLimit: boolean }

/**
 * A pipeline step candidate that the harness can score. It reads only the recorded fixture (offline) and
 * implements one or both steps. Later tasks (T006-T008) add their own subjects under `src/subjects/`.
 */
export interface Subject {
  name: string;
  /** Predicts the core files a reader must open. Paths relative to the repo root. */
  coreFiles?(fixture: Fixture): string[] | Promise<string[]>;
  /** Predicts the concepts a ladder should teach. */
  concepts?(fixture: Fixture): string[] | Promise<string[]>;
}

/** An LLM subject (T006+): also reports per-repo run data and verdicts against its pre-registered thresholds. */
export interface MeasuredSubject extends Subject {
  /** Model calls, cost and whether a step cap / token budget stopped the run, for one repo of the last run. */
  runStats(fullName: string): RunStats | undefined;
  /** Verdict lines against the pre-registered thresholds, given this report and the baseline's mean recall. */
  verdicts(report: { mean: { recall: number }; rows: { hitLimit?: boolean }[] }, baselineMeanRecall: number): string[];
}
