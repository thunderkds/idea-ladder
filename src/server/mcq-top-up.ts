// T033: a pool level (L0, L1, L3) that keeps fewer than MIN_MCQ_POOL MCQs after check-and-dedupe and blind-solve
// gets up to MCQ_TOP_UP_ROUNDS extra rounds before save-ladder. Every top-up question passes the same answer-key check
// (checkAndDedupe), near-duplicate check (keepDistinct against the kept ladder) and blind solve (blindSolveLevels).
// A level still thin after the last round is saved as before: flag insufficient-pool, no bypass. Stores nothing.
import type { LevelId } from "../shared/levels.ts";
import { blindSolveLevels } from "./blind-solver.ts";
import { checkAndDedupe, type GeneratedLevel, type LadderLevel } from "./check-and-dedupe.ts";
import { keepDistinct } from "./dedupe.ts";
import type { Dropped, LevelChunk, Mcq } from "./level-generator.ts";
import type { Generate } from "./model-a.ts";
import type { CallUsage } from "./repo-reader.ts";
import { MCQ_TOP_UP_ROUNDS, MIN_MCQ_POOL, POOL_LEVELS, type TopUpReport } from "./save-ladder.ts";

/** Inngest memoizes by step id: one fixed id per level and round (the round's blind solve adds `-blind-solve`). */
export const topUpStepId = (level: LevelId, round: number) => `top-up-${level}-${round}` as const;

/** The levels that get round `round` (1 to MCQ_TOP_UP_ROUNDS): generated pool levels below MIN_MCQ_POOL. */
export function levelsNeedingTopUp(levels: LadderLevel[], round: number): LevelId[] {
  if (round < 1 || round > MCQ_TOP_UP_ROUNDS) return [];
  return levels
    .filter((l) => l.status === "generated" && POOL_LEVELS.has(l.level) && l.mcqs.length < MIN_MCQ_POOL)
    .map((l) => l.level);
}

/** What one part of a round keeps, and what it drops with the reason. */
export type TopUpRound = { mcqs: Mcq[]; dropped: Dropped[] };

/** The candidates that are no near-duplicate of a question or card front the ladder already keeps. */
function dropLadderDuplicates(candidates: Mcq[], levels: LadderLevel[], dedupeJaccard: number): TopUpRound {
  const kept = levels.flatMap((l) =>
    l.status === "generated" ? [...l.mcqs.map((m) => m.question), ...l.cards.map((c) => c.front)] : [],
  );
  const distinct = keepDistinct([...kept, ...candidates.map((m) => m.question)], dedupeJaccard).slice(kept.length);
  return {
    mcqs: candidates.filter((_, i) => distinct[i]),
    dropped: candidates.filter((_, i) => !distinct[i]).map((item) => ({ item, reason: "duplicate" })),
  };
}

/** A level holding only the round's MCQs, so the first round's check functions run on them unchanged. */
const roundLevel = (level: LevelId, mcqs: Mcq[], dropped: Dropped[]): GeneratedLevel => ({
  level,
  status: "generated",
  goal: "",
  passTest: { kind: "", description: "" },
  cards: [],
  mcqs,
  dropped,
});

/** Answer-key check (regenerate max 2), verbatim check, then the duplicate check against the kept ladder. */
export async function checkTopUp(input: {
  level: LevelId;
  /** generateTopUpMcqs output. */
  generated: TopUpRound;
  /** The ladder as it stands (first round plus earlier top-up rounds). */
  levels: LadderLevel[];
  /** Every chunk of this repo + SHA, in id order. */
  chunks: LevelChunk[];
  generate: Generate;
  dedupeJaccard: number;
  onUsage?: (usage: CallUsage) => void;
}): Promise<TopUpRound> {
  const [checked] = (await checkAndDedupe({
    levels: [roundLevel(input.level, input.generated.mcqs, input.generated.dropped)],
    chunks: input.chunks,
    generate: input.generate,
    dedupeJaccard: input.dedupeJaccard,
    onUsage: input.onUsage,
  })) as GeneratedLevel[];
  const distinct = dropLadderDuplicates(checked?.mcqs ?? [], input.levels, input.dedupeJaccard);
  return { mcqs: distinct.mcqs, dropped: [...(checked?.dropped ?? []), ...distinct.dropped] };
}

/** Blind solve of the checked candidates (regenerate max 2), then the duplicate check again for any replacement. */
export async function solveTopUp(input: {
  level: LevelId;
  candidates: Mcq[];
  levels: LadderLevel[];
  chunks: LevelChunk[];
  generateA: Generate;
  generateB: Generate;
  dedupeJaccard: number;
  onUsageA?: (usage: CallUsage) => void;
  onUsageB?: (usage: CallUsage) => void;
}): Promise<TopUpRound> {
  const solved = await blindSolveLevels({
    levels: [roundLevel(input.level, input.candidates, [])],
    chunks: input.chunks,
    generateA: input.generateA,
    generateB: input.generateB,
    dedupeJaccard: input.dedupeJaccard,
    onUsageA: input.onUsageA,
    onUsageB: input.onUsageB,
  });
  const l = solved.levels[0] as GeneratedLevel;
  const distinct = dropLadderDuplicates(l.mcqs, input.levels, input.dedupeJaccard);
  return { mcqs: distinct.mcqs, dropped: [...l.dropped, ...distinct.dropped] };
}

export type TopUpMcqPoolsInput = {
  /** The blind-solve output, L0 to L4. */
  levels: LadderLevel[];
  /** Round `round` of `level`: generation and code checks (one memoized step). */
  check: (level: LevelId, round: number, levels: LadderLevel[]) => Promise<TopUpRound>;
  /** The blind solve of that round's candidates (its own memoized step, so a retry calls no generator). */
  solve: (level: LevelId, round: number, levels: LadderLevel[], candidates: Mcq[]) => Promise<TopUpRound>;
};

/**
 * AC 1, 3, 6: round by round, then level by level (so each round's duplicate check sees every earlier addition), each
 * thin pool level gets a round until it has MIN_MCQ_POOL or has had MCQ_TOP_UP_ROUNDS. Keeps every MCQ the checks
 * pass (a pool above MIN_MCQ_POOL is fine). Returns the levels to save and the top-up report per pool level.
 */
export async function topUpMcqPools(
  input: TopUpMcqPoolsInput,
): Promise<{ levels: LadderLevel[]; topUps: Partial<Record<LevelId, TopUpReport>> }> {
  let levels = input.levels;
  const topUps: Partial<Record<LevelId, TopUpReport>> = {};
  for (const l of levels)
    if (l.status === "generated" && POOL_LEVELS.has(l.level)) topUps[l.level] = { rounds: 0, added: 0, dropped: {} };
  for (let round = 1; round <= MCQ_TOP_UP_ROUNDS; round++)
    for (const level of levelsNeedingTopUp(levels, round)) {
      const checked = await input.check(level, round, levels);
      const solved =
        checked.mcqs.length > 0 ? await input.solve(level, round, levels, checked.mcqs) : { mcqs: [], dropped: [] };
      const dropped = [...checked.dropped, ...solved.dropped];
      levels = levels.map((l) =>
        l.level === level && l.status === "generated"
          ? { ...l, mcqs: [...l.mcqs, ...solved.mcqs], dropped: [...l.dropped, ...dropped] }
          : l,
      );
      const report = topUps[level] as TopUpReport;
      report.rounds += 1;
      report.added += solved.mcqs.length;
      for (const d of dropped) report.dropped[d.reason] = (report.dropped[d.reason] ?? 0) + 1;
    }
  return { levels, topUps };
}
