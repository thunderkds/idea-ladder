import type pg from 'pg';
import { LEVEL_IDS, levelLockState, type LevelId, type LockState } from './lock-state.js';

export interface PassTest {
  kind: string;
  description: string;
}

export interface LevelView {
  id: LevelId;
  title: string;
  goal: string;
  passTest: PassTest;
  lock: LockState;
}

export interface LadderView {
  repoFullName: string;
  commitSha: string;
  status: string;
  levels: LevelView[];
}

export const NOT_GENERATED = 'Not generated yet';
export const CONCEPT_ONLY_SKIPPED = 'concept-only-skipped';
export const CONCEPT_ONLY_TEXT = 'Concept-only ladder: this level is not generated for this repo';

/** Fixed titles and pass tests from the requirement's L0 to L4 table. Used when a level row is missing. */
const FIXED_LEVELS: Record<LevelId, { title: string; passTest: PassTest }> = {
  L0: { title: 'Prerequisites', passTest: { kind: 'concept-mcq', description: 'Concept ladder tests' } },
  L1: { title: 'Run it', passTest: { kind: 'run-log-and-explanation', description: 'Screenshot or log + 3-sentence explanation' } },
  L2: { title: 'Modify', passTest: { kind: 'branch-diff-and-diff-questions', description: 'Branch or diff link + questions generated from your diff' } },
  L3: { title: 'Understand', passTest: { kind: 'verified-mcq', description: 'Verified MCQs on core files' } },
  L4: { title: 'Rebuild or contribute', passTest: { kind: 'repo-or-merged-pr', description: 'Repo link or PR link' } },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface LevelRow {
  level_id: string;
  goal: string;
  pass_test_kind: string;
  pass_test_description: string;
}

/**
 * Level rows are written by T008 (`levels` table, not in this schema yet). Until that table exists
 * this returns no rows, so the page shows the fixed levels.
 */
async function readLevelRows(pool: pg.Pool, ladderId: string): Promise<Map<string, LevelRow>> {
  const exists = await pool.query<{ ok: boolean }>(`SELECT to_regclass('public.levels') IS NOT NULL AS ok`);
  if (!exists.rows[0]?.ok) return new Map();
  const { rows } = await pool.query<LevelRow>(
    'SELECT level_id, goal, pass_test_kind, pass_test_description FROM levels WHERE ladder_id = $1',
    [ladderId],
  );
  return new Map(rows.map((r) => [r.level_id, r]));
}

/** Levels the learner has passed. T012 writes passes; until then nobody has passed a level. */
export async function readPassedLevelIds(): Promise<string[]> {
  return [];
}

export type ReadPassed = (pool: pg.Pool, userId: string, ladderId: string) => Promise<string[]>;

export interface ViewDeps {
  /** Replaces the pass lookup. Tests use it; T012 will make the default real. */
  readPassed?: ReadPassed;
}

export async function getLadderView(pool: pg.Pool, ladderId: string, userId: string, deps: ViewDeps = {}): Promise<LadderView | null> {
  if (!UUID.test(ladderId)) return null;
  const ladder = await pool.query<{ repo_full_name: string; commit_sha: string; status: string }>(
    'SELECT repo_full_name, commit_sha, status FROM ladders WHERE id = $1',
    [ladderId],
  );
  const row = ladder.rows[0];
  if (!row) return null;
  const [levelRows, passed] = await Promise.all([readLevelRows(pool, ladderId), (deps.readPassed ?? readPassedLevelIds)(pool, userId, ladderId)]);
  const locks = levelLockState(passed);
  const levels = LEVEL_IDS.map((id, i): LevelView => {
    const fixed = FIXED_LEVELS[id];
    const saved = levelRows.get(id);
    const skipped = saved?.pass_test_kind === CONCEPT_ONLY_SKIPPED;
    return {
      id,
      title: fixed.title,
      goal: skipped ? CONCEPT_ONLY_TEXT : saved?.goal || NOT_GENERATED,
      passTest: saved && !skipped ? { kind: saved.pass_test_kind, description: saved.pass_test_description } : fixed.passTest,
      lock: locks[i] as LockState,
    };
  });
  return { repoFullName: row.repo_full_name, commitSha: row.commit_sha, status: row.status, levels };
}

export interface LadderListItem {
  id: string;
  repoFullName: string;
}

/** Saved ladders this learner started (ladder_learners). Newest first, one row per ladder. */
export async function listMyLadders(pool: pg.Pool, userId: string): Promise<LadderListItem[]> {
  const { rows } = await pool.query<{ id: string; repo_full_name: string }>(
    `SELECT l.id, l.repo_full_name FROM ladder_learners m
     JOIN ladders l ON l.repo_full_name = m.repo_full_name AND l.commit_sha = m.commit_sha
     WHERE m.user_id = $1
     ORDER BY l.created_at DESC, l.id`,
    [userId],
  );
  return rows.map((r) => ({ id: r.id, repoFullName: r.repo_full_name }));
}

export function readmeUrl(repoFullName: string, commitSha: string): string {
  return `https://github.com/${encodeRepo(repoFullName)}/blob/${commitSha}/README.md`;
}

export function deepWikiUrl(repoFullName: string): string {
  return `https://deepwiki.com/${encodeRepo(repoFullName)}`;
}

function encodeRepo(repoFullName: string): string {
  return repoFullName.split('/').map(encodeURIComponent).join('/');
}
