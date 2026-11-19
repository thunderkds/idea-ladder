// T008 (8d): step save-ladder, the only writer of a ladder's content. One transaction writes the ladder (status
// unverified), its 5 levels, cards, MCQ pools and the generation report, and sets the job done. Keyed by repo + SHA:
// a retried step (or a ladder that already exists) writes nothing new.
import type { SQL } from "bun";
import type { Totals } from "../../eval/src/cost.ts";
import { FIXED_LEVELS } from "../shared/levels.ts";
import type { LadderLevel } from "./check-and-dedupe.ts";

export const SAVE_LADDER_STEP = "save-ladder";
/** AC 2: L0 and L3 keep at least 8 MCQs; every level at least 5 cards. Below that the level is flagged. */
export const MIN_MCQ_POOL = 8;
export const MIN_CARDS = 5;
const POOL_LEVELS = new Set(["L0", "L3"]);

export type LevelFlag = "insufficient-pool" | "insufficient-cards";
export type LevelReport = {
  level: LadderLevel["level"];
  status: LadderLevel["status"];
  generated: { cards: number; mcqs: number };
  kept: { cards: number; mcqs: number };
  dropped: Record<string, number>;
  flags: LevelFlag[];
};
/** costByStep: this job's cost entries per step (usd null on the claude-code back end); null if not reachable. */
export type GenerationReport = { levels: LevelReport[]; costByStep: Record<string, Totals> | null };

function levelReport(l: LadderLevel): LevelReport {
  if (l.status !== "generated")
    return {
      level: l.level,
      status: l.status,
      generated: { cards: 0, mcqs: 0 },
      kept: { cards: 0, mcqs: 0 },
      dropped: {},
      flags: [],
    };
  const dropped: Record<string, number> = {};
  let droppedMcqs = 0;
  for (const d of l.dropped) {
    dropped[d.reason] = (dropped[d.reason] ?? 0) + 1;
    if ("key" in d.item) droppedMcqs += 1;
  }
  const flags: LevelFlag[] = [];
  if (POOL_LEVELS.has(l.level) && l.mcqs.length < MIN_MCQ_POOL) flags.push("insufficient-pool");
  if (l.cards.length < MIN_CARDS) flags.push("insufficient-cards");
  return {
    level: l.level,
    status: l.status,
    generated: { cards: l.cards.length + l.dropped.length - droppedMcqs, mcqs: l.mcqs.length + droppedMcqs },
    kept: { cards: l.cards.length, mcqs: l.mcqs.length },
    dropped,
    flags,
  };
}

export function buildReport(levels: LadderLevel[], costByStep: Record<string, Totals> | null): GenerationReport {
  return { levels: levels.map(levelReport), costByStep };
}

export type SaveLadderInput = {
  jobId: string;
  repo: string;
  sha: string;
  /** The check-and-dedupe output, L0 to L4. */
  levels: LadderLevel[];
  costByStep: Record<string, Totals> | null;
};

export async function saveLadder(sql: SQL, input: SaveLadderInput): Promise<{ ladderId: string }> {
  const { jobId, repo, sha, levels } = input;
  const report = buildReport(levels, input.costByStep);
  return await sql.begin(async (tx) => {
    const [created] = await tx`
      INSERT INTO ladders (repo_full_name, commit_sha, status) VALUES (${repo}, ${sha}, 'unverified')
      ON CONFLICT (repo_full_name, commit_sha) DO NOTHING RETURNING id::text AS id`;
    let ladderId = created?.id as string | undefined;
    if (!ladderId) {
      // A retried step (or another job) saved it already: its content was written in that same transaction.
      [{ id: ladderId }] = await tx`
        SELECT id::text AS id FROM ladders WHERE repo_full_name = ${repo} AND commit_sha = ${sha}`;
    } else {
      for (const [i, l] of levels.entries()) {
        const fixed = FIXED_LEVELS[l.level];
        const flags = report.levels[i]?.flags ?? [];
        const g = l.status === "generated" ? l : undefined;
        await tx`
          INSERT INTO ladder_levels (ladder_id, level, title, goal, pass_test_kind, pass_test_description, skip_reason, flags)
          VALUES (${ladderId}, ${l.level}, ${fixed.title}, ${g?.goal ?? ""}, ${g?.passTest.kind ?? fixed.passTest.kind},
            ${g?.passTest.description ?? fixed.passTest.description}, ${l.status === "skipped" ? l.kind : null},
            ARRAY(SELECT jsonb_array_elements_text(${flags}::jsonb)))`;
        if (!g) continue;
        for (const [p, c] of g.cards.entries())
          await tx`
            INSERT INTO cards (ladder_id, level, position, front, back, chunk_id)
            VALUES (${ladderId}, ${l.level}, ${p}, ${c.front}, ${c.back}, ${c.chunkId})`;
        for (const [p, m] of g.mcqs.entries())
          await tx`
            INSERT INTO mcqs (ladder_id, level, position, question, options, key, chunk_id)
            VALUES (${ladderId}, ${l.level}, ${p}, ${m.question}, ${m.options}::jsonb, ${m.key}, ${m.chunkId})`;
      }
      await tx`INSERT INTO generation_reports (ladder_id, report) VALUES (${ladderId}, ${report}::jsonb)`;
    }
    await tx`UPDATE generation_jobs SET status = 'done', updated_at = now() WHERE id = ${jobId} AND status = 'mapped'`;
    return { ladderId: ladderId as string };
  });
}
