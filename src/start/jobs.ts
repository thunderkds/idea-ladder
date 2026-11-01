import type pg from 'pg';
import { confidenceScore } from './confidence.js';
import type { RepoSnapshot } from './github.js';

export type JobStatus = 'queued' | 'running' | 'fetched' | 'failed';

export interface Job {
  id: string;
  repoFullName: string;
  commitSha: string;
  status: JobStatus;
  reason: string | null;
  resetAt: Date | null;
}

interface JobRow {
  id: string;
  repo_full_name: string;
  commit_sha: string;
  status: JobStatus;
  reason: string | null;
  reset_at: Date | null;
}

const JOB_COLUMNS = 'id, repo_full_name, commit_sha, status, reason, reset_at';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toJob(r: JobRow): Job {
  return { id: r.id, repoFullName: r.repo_full_name, commitSha: r.commit_sha, status: r.status, reason: r.reason, resetAt: r.reset_at };
}

export async function findLadderId(pool: pg.Pool, repoFullName: string, sha: string): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>('SELECT id FROM ladders WHERE repo_full_name = $1 AND commit_sha = $2', [repoFullName, sha]);
  return rows[0]?.id ?? null;
}

/** Records that this learner started the ladder for repo + SHA. Starting again writes nothing. */
export async function addLearner(pool: pg.Pool, userId: string, repoFullName: string, sha: string): Promise<void> {
  await pool.query(
    'INSERT INTO ladder_learners (user_id, repo_full_name, commit_sha) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
    [userId, repoFullName, sha],
  );
}

/**
 * Insert-on-conflict against the partial unique index on open jobs: parallel callers for one repo + SHA
 * get one row. `created` is true only for the caller whose insert won, so only that caller sends the event.
 */
export async function createOrFindJob(
  pool: pg.Pool,
  repoFullName: string,
  sha: string,
  startedBy: string,
): Promise<{ jobId: string; created: boolean }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO generation_jobs (repo_full_name, commit_sha, started_by) VALUES ($1, $2, $3)
       ON CONFLICT (repo_full_name, commit_sha) WHERE status <> 'failed' DO NOTHING RETURNING id`,
      [repoFullName, sha, startedBy],
    );
    if (inserted.rows[0]) return { jobId: inserted.rows[0].id, created: true };
    const existing = await pool.query<{ id: string }>(
      `SELECT id FROM generation_jobs WHERE repo_full_name = $1 AND commit_sha = $2 AND status <> 'failed'`,
      [repoFullName, sha],
    );
    if (existing.rows[0]) return { jobId: existing.rows[0].id, created: false };
    // The open job failed between our insert and our select: try the insert again.
  }
  throw new Error('could not create or find a generation job');
}

export async function getJob(pool: pg.Pool, jobId: string): Promise<Job | null> {
  if (!UUID.test(jobId)) return null;
  const { rows } = await pool.query<JobRow>(`SELECT ${JOB_COLUMNS} FROM generation_jobs WHERE id = $1`, [jobId]);
  return rows[0] ? toJob(rows[0]) : null;
}

export async function markJobRunning(pool: pg.Pool, jobId: string): Promise<void> {
  await pool.query(`UPDATE generation_jobs SET status = 'running', updated_at = now() WHERE id = $1 AND status = 'queued'`, [jobId]);
}

export async function markJobFailed(pool: pg.Pool, jobId: string, reason: string, resetAt?: Date): Promise<void> {
  await pool.query(
    `UPDATE generation_jobs SET status = 'failed', reason = $2, reset_at = $3, updated_at = now() WHERE id = $1 AND status <> 'fetched'`,
    [jobId, reason, resetAt ?? null],
  );
}

/** One transaction: snapshot + confidence + job status `fetched`. Safe to run twice for the same repo + SHA. */
export async function saveSnapshot(pool: pg.Pool, jobId: string, repoFullName: string, snapshot: RepoSnapshot): Promise<void> {
  const confidence = confidenceScore(snapshot);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO repo_snapshots
         (repo_full_name, commit_sha, default_branch, archived, readme, topics, languages, dep_files, open_issues, good_first_issues, tree)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (repo_full_name, commit_sha) DO NOTHING`,
      [
        repoFullName, snapshot.sha, snapshot.defaultBranch, snapshot.archived, snapshot.readme,
        JSON.stringify(snapshot.topics), JSON.stringify(snapshot.languages), JSON.stringify(snapshot.depFiles),
        snapshot.openIssues, snapshot.goodFirstIssues, JSON.stringify(snapshot.tree),
      ],
    );
    await client.query(
      `INSERT INTO repo_confidence (repo_full_name, commit_sha, score, level, fallback_to_concepts, reasons)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (repo_full_name, commit_sha) DO NOTHING`,
      [repoFullName, snapshot.sha, confidence.score, confidence.level, confidence.fallbackToConcepts, JSON.stringify(confidence.reasons)],
    );
    await client.query(`UPDATE generation_jobs SET status = 'fetched', reason = NULL, updated_at = now() WHERE id = $1`, [jobId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
