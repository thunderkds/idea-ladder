// T010: reads a ladder and its level rows for the ladder view. Never calls an LLM or GitHub.
import type { SQL } from "bun";
import {
  FIXED_LEVELS,
  LEVEL_IDS,
  type LevelId,
  type LevelLock,
  levelLockState,
  type PassTest,
} from "../shared/levels.ts";

export type LevelView = { id: LevelId; title: string; goal: string; passTest: PassTest; lock: LevelLock };
export type LadderView = { repoFullName: string; commitSha: string; status: string; levels: LevelView[] };

/** Ids of the levels this learner passed on this ladder. T012 will supply the real one; until then nobody has passed. */
export type PassedLevels = (ladderId: string, userId: string) => Promise<string[]>;
export const noPasses: PassedLevels = async () => [];

export const NOT_GENERATED = "Not generated yet";
export const CONCEPT_ONLY = "Concept-only ladder: this level is not generated for this repo";

const LADDER_ID = /^[1-9][0-9]{0,17}$/; // fits a bigint; "does-not-exist" and "1e3" are not ids

export async function ladderExists(sql: SQL, ladderId: string): Promise<boolean> {
  if (!LADDER_ID.test(ladderId)) return false;
  return (await sql`SELECT 1 FROM ladders WHERE id = ${ladderId}`).length > 0;
}

/** The ladder with its five levels and this learner's lock state; undefined for an unknown id. */
export async function getLadderView(
  sql: SQL,
  ladderId: string,
  userId: string,
  passed: PassedLevels = noPasses,
): Promise<LadderView | undefined> {
  if (!LADDER_ID.test(ladderId)) return undefined;
  const [ladder] = await sql`SELECT repo_full_name, commit_sha, status FROM ladders WHERE id = ${ladderId}`;
  if (!ladder) return undefined;
  const rows = await sql`
    SELECT level, title, goal, pass_test_kind, pass_test_description, skip_reason
    FROM ladder_levels WHERE ladder_id = ${ladderId}`;
  const byLevel = new Map<string, Record<string, string | null>>(rows.map((r: { level: string }) => [r.level, r]));
  const locks = levelLockState(await passed(ladderId, userId));
  return {
    repoFullName: ladder.repo_full_name,
    commitSha: ladder.commit_sha,
    status: ladder.status,
    levels: LEVEL_IDS.map((id, i) => {
      const row = byLevel.get(id);
      const fixed = FIXED_LEVELS[id];
      return {
        id,
        title: row?.title ?? fixed.title,
        goal: row
          ? row.skip_reason === "concept-only-skipped"
            ? CONCEPT_ONLY
            : (row.goal ?? NOT_GENERATED)
          : NOT_GENERATED,
        passTest: row
          ? {
              kind: row.pass_test_kind ?? fixed.passTest.kind,
              description: row.pass_test_description ?? fixed.passTest.description,
            }
          : fixed.passTest,
        lock: locks[i] ?? "locked",
      };
    }),
  };
}

export type LadderListItem = { ladderId: string; repo: string };

/** Saved ladders whose generation job this learner started (a cache hit alone is not listed yet: T010 cut list). */
export async function listLadders(sql: SQL, userId: string): Promise<LadderListItem[]> {
  const rows = await sql`
    SELECT DISTINCT l.id::text AS ladder_id, l.id, l.repo_full_name
    FROM generation_jobs j
    JOIN ladders l ON l.repo_full_name = j.repo_full_name AND l.commit_sha = j.commit_sha
    WHERE j.started_by = ${userId}
    ORDER BY l.id DESC`;
  return rows.map((r: { ladder_id: string; repo_full_name: string }) => ({
    ladderId: r.ladder_id,
    repo: r.repo_full_name,
  }));
}
