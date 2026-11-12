// The request path of /start: 1 GitHub call (resolve HEAD SHA), 1 indexed lookup, then a cached ladder or a job.
import type { SQL } from "bun";
import type { GithubRepoClient } from "./github-repo.ts";
import type { GenerateRequested } from "./ladder-generate.ts";
import { parseRepoUrl, type RepoRef, UnsupportedUrlError } from "./repo-url.ts";

export const MAX_URL_LENGTH = 2048;
export type Enqueue = (data: GenerateRequested) => Promise<void>;
export type StartResult = { ladderId: string } | { jobId: string };

export class EnqueueError extends Error {}

/** The learner created the hourly maximum of new jobs; `retryAt` is when the oldest one leaves the window. */
export class TooManyStartsError extends Error {
  constructor(public readonly retryAt: Date) {
    super("too many new generation jobs in the last hour");
    this.name = "TooManyStartsError";
  }
}

/** Checks the raw `url` input; returns the repo or an error code. Makes no network call. */
export function checkUrl(input: unknown): RepoRef | "url-required" | "url-too-long" | "unsupported-url" {
  if (typeof input !== "string" || !input.trim()) return "url-required";
  if (input.length > MAX_URL_LENGTH) return "url-too-long";
  try {
    return parseRepoUrl(input);
  } catch (err) {
    if (err instanceof UnsupportedUrlError) return "unsupported-url";
    throw err;
  }
}

export async function startLadder(
  deps: { sql: SQL; github: GithubRepoClient; enqueue: Enqueue; maxNewJobsPerHour: number },
  userId: string,
  ref: RepoRef,
): Promise<StartResult> {
  const { sql, github, enqueue, maxNewJobsPerHour } = deps;
  const { fullName: repo, sha } = await github.resolveHead(ref);

  const [ladder] = await sql`SELECT id::text FROM ladders WHERE repo_full_name = ${repo} AND commit_sha = ${sha}`;
  if (ladder) return { ladderId: ladder.id };

  // Insert-on-conflict on the open-job key: concurrent callers get the same row; only the inserter sends the event.
  // Per-learner limit on NEW jobs only; a per-learner advisory lock keeps parallel starts from overshooting it.
  const job = await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`start-limit:${userId}`}))`;
    const [open] = await tx`
      SELECT 1 FROM generation_jobs WHERE repo_full_name = ${repo} AND commit_sha = ${sha} AND status <> 'failed'`;
    if (!open) {
      const [recent] = await tx`
        SELECT count(*)::int AS n, min(created_at) AS oldest FROM generation_jobs
        WHERE started_by = ${userId} AND created_at > now() - interval '1 hour'`;
      if (recent.n >= maxNewJobsPerHour) {
        throw new TooManyStartsError(new Date((recent.oldest as Date).getTime() + 3_600_000));
      }
    }
    const [row] = await tx`
      INSERT INTO generation_jobs (repo_full_name, commit_sha, started_by) VALUES (${repo}, ${sha}, ${userId})
      ON CONFLICT (repo_full_name, commit_sha) WHERE status <> 'failed'
      DO UPDATE SET updated_at = generation_jobs.updated_at
      RETURNING id::text, (xmax = 0) AS inserted`;
    await tx`INSERT INTO generation_job_waiters (job_id, user_id) VALUES (${row.id}, ${userId}) ON CONFLICT DO NOTHING`;
    return row as { id: string; inserted: boolean };
  });

  if (job.inserted) {
    try {
      await enqueue({ repo, sha, jobId: job.id });
    } catch (err) {
      console.warn("enqueue failed:", err instanceof Error ? err.message : err);
      await sql`UPDATE generation_jobs SET status = 'failed', reason = 'queue-unavailable', updated_at = now()
        WHERE id = ${job.id}`;
      throw new EnqueueError("could not send ladder/generate.requested");
    }
  }
  return { jobId: job.id };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type JobView = {
  status: "queued" | "running" | "fetched" | "failed";
  repo: string;
  sha: string;
  reason?: string;
  resetAt?: string;
  ladderId?: string;
};

/** The job as its waiters see it; undefined for an unknown id or a learner who is not waiting on it. */
export async function jobForLearner(sql: SQL, jobId: string, userId: string): Promise<JobView | undefined> {
  if (!UUID.test(jobId)) return undefined;
  const [row] = await sql`
    SELECT j.status, j.reason, j.reset_at, j.repo_full_name, j.commit_sha, l.id::text AS ladder_id
    FROM generation_jobs j
    LEFT JOIN ladders l ON l.repo_full_name = j.repo_full_name AND l.commit_sha = j.commit_sha
    WHERE j.id = ${jobId}
      AND EXISTS (SELECT 1 FROM generation_job_waiters w WHERE w.job_id = j.id AND w.user_id = ${userId})`;
  if (!row) return undefined;
  return {
    status: row.status,
    repo: row.repo_full_name,
    sha: row.commit_sha,
    ...(row.reason ? { reason: row.reason } : {}),
    ...(row.reset_at ? { resetAt: (row.reset_at as Date).toISOString() } : {}),
    ...(row.ladder_id ? { ladderId: row.ladder_id } : {}),
  };
}
