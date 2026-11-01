import type pg from 'pg';
import { type GithubOptions, GitHubError, RateLimitError, RepoEmptyError, RepoNotFoundError, resolveHead } from './github.js';
import { addLearner, createOrFindJob, findLadderId, markJobFailed } from './jobs.js';
import type { RepoRef } from './repo-url.js';

export const LADDER_REQUESTED = 'ladder/generate.requested';

export interface LadderRequested {
  repo: string;
  sha: string;
  jobId: string;
}

export type Enqueue = (data: LadderRequested) => Promise<void>;

export type StartResult = { kind: 'hit'; ladderId: string } | { kind: 'job'; jobId: string };

export type StartErrorCode = 'repo-not-found' | 'repo-empty' | 'rate-limited' | 'github-unavailable' | 'enqueue-failed';

export class StartError extends Error {
  constructor(
    public readonly code: StartErrorCode,
    public readonly resetAt?: Date,
  ) {
    super(code);
    this.name = 'StartError';
  }
}

export interface StartDeps {
  pool: pg.Pool;
  github: GithubOptions;
  enqueue: Enqueue;
}

/**
 * The request path: at most one GitHub call and a few indexed lookups. No LLM, no repo reading;
 * generation runs in the background.
 */
export async function startLadder(deps: StartDeps, repo: RepoRef, userId: string): Promise<StartResult> {
  let head;
  try {
    head = await resolveHead(deps.github, repo.owner, repo.name);
  } catch (err) {
    if (err instanceof RepoNotFoundError) throw new StartError('repo-not-found');
    if (err instanceof RepoEmptyError) throw new StartError('repo-empty');
    if (err instanceof RateLimitError) throw new StartError('rate-limited', err.resetAt);
    if (err instanceof GitHubError || err instanceof TypeError) throw new StartError('github-unavailable');
    throw err;
  }

  // Before any lookup: every path (hit, joined job, new job) has the record, and a failed write fails the request.
  await addLearner(deps.pool, userId, head.fullName, head.sha);
  const ladderId = await findLadderId(deps.pool, head.fullName, head.sha);
  if (ladderId) return { kind: 'hit', ladderId };

  const { jobId, created } = await createOrFindJob(deps.pool, head.fullName, head.sha, userId);
  if (created) {
    try {
      await deps.enqueue({ repo: head.fullName, sha: head.sha, jobId });
    } catch (err) {
      console.error('Could not send the ladder/generate.requested event:', err instanceof Error ? err.message : err);
      await markJobFailed(deps.pool, jobId, 'enqueue-failed');
      throw new StartError('enqueue-failed');
    }
  }
  return { kind: 'job', jobId };
}
