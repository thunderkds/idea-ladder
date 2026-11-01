import { Inngest, NonRetriableError } from 'inngest';
import type pg from 'pg';
import { type GithubOptions, RateLimitError, RepoNotFoundError, fetchRepoSnapshot } from '../start/github.js';
import { pickCoreFilesStep, type PickCoreFilesStepResult, type ReaderDeps } from '../reader/pick-step.js';
import { getJob, markJobFailed, markJobRunning, saveSnapshot } from '../start/jobs.js';
import { LADDER_REQUESTED, type Enqueue, type LadderRequested } from '../start/service.js';

export const inngest = new Inngest({ id: 'idea-ladder' });

export const sendLadderRequested: Enqueue = async (data) => {
  // The job id is the event id, so Inngest drops a duplicate send for the same job.
  await inngest.send({ name: LADDER_REQUESTED, id: data.jobId, data });
};

export type FetchRepoResult = { status: 'fetched' } | { status: 'failed'; reason: string };

function readEventData(raw: unknown): LadderRequested {
  const d = (raw ?? {}) as Partial<LadderRequested>;
  if (typeof d.repo !== 'string' || typeof d.sha !== 'string' || typeof d.jobId !== 'string') {
    throw new NonRetriableError('ladder/generate.requested needs repo, sha and jobId');
  }
  return { repo: d.repo, sha: d.sha, jobId: d.jobId };
}

/**
 * Step `fetch-repo`. A rate limit or a missing repo is final for this job: it is recorded and the step
 * returns normally (a retry before the reset time cannot help). Any other error throws, so Inngest retries
 * this step alone.
 */
export async function fetchRepo(pool: pg.Pool, github: GithubOptions, data: LadderRequested): Promise<FetchRepoResult> {
  await markJobRunning(pool, data.jobId);
  let snapshot;
  try {
    snapshot = await fetchRepoSnapshot(github, data.repo, data.sha);
  } catch (err) {
    if (err instanceof RateLimitError) {
      await markJobFailed(pool, data.jobId, 'rate-limited', err.resetAt);
      return { status: 'failed', reason: 'rate-limited' };
    }
    if (err instanceof RepoNotFoundError) {
      await markJobFailed(pool, data.jobId, 'repo-not-found');
      return { status: 'failed', reason: 'repo-not-found' };
    }
    throw err;
  }
  await saveSnapshot(pool, data.jobId, data.repo, snapshot);
  return { status: 'fetched' };
}

/**
 * `reader` is optional: without it (no model configured) the function stops after `fetch-repo`, as before.
 * With it, step `pick-core-files` runs next. Inngest keeps the result of a finished step, so a retry of
 * `pick-core-files` does not run `fetch-repo` again.
 */
export function createLadderGenerate(pool: pg.Pool, github: GithubOptions, reader?: ReaderDeps) {
  return inngest.createFunction(
    {
      id: 'ladder-generate',
      triggers: [{ event: LADDER_REQUESTED }],
      // Retries are spent: the job must not stay `running` forever.
      onFailure: async ({ event }) => {
        const jobId = (event.data.event?.data as Partial<LadderRequested> | undefined)?.jobId;
        if (typeof jobId !== 'string') return;
        const job = await getJob(pool, jobId);
        await markJobFailed(pool, jobId, job?.status === 'picking' ? 'reader-error' : 'github-error');
      },
    },
    async ({ event, step }) => {
      const data = readEventData(event.data);
      const fetched = await step.run('fetch-repo', () => fetchRepo(pool, github, data));
      if (!reader || fetched.status === 'failed') return fetched;
      // Later tasks add steps after this one.
      return await step.run('pick-core-files', (): Promise<PickCoreFilesStepResult> => pickCoreFilesStep(pool, github, reader, data));
    },
  );
}
