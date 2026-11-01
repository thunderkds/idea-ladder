import type { LanguageModel } from 'ai';
import type pg from 'pg';
import { markJobFailed, markJobPicking } from '../start/jobs.js';
import { RateLimitError, type GithubOptions } from '../start/github.js';
import type { LadderRequested } from '../start/service.js';
import { getCoreFiles, saveCoreFiles } from './core-files.js';
import { jobCostSink } from './cost.js';
import { cachedFileReader, fetchRepoTree } from './github-files.js';
import { pickCoreFiles, ReaderInvalidOutputError, type ReaderCostSink, type ReaderLimits } from './repo-reader.js';

export interface ReaderDeps {
  model: LanguageModel;
  limits: ReaderLimits;
  /** Defaults to the job cost log. Tests pass a spy. */
  logCost?: (jobId: string, repo: string, sha: string) => ReaderCostSink;
}

export type PickCoreFilesStepResult = { status: 'picked'; count: number } | { status: 'failed'; reason: string };

/**
 * Step `pick-core-files`. A rate limit or an answer the reader could not make valid is final for this job: it is
 * recorded and the step returns normally. Any other error throws, so Inngest retries this step alone.
 * Core files are keyed by repo + SHA: a second job for the same commit reuses them and spends no model call.
 */
export async function pickCoreFilesStep(pool: pg.Pool, github: GithubOptions, reader: ReaderDeps, data: LadderRequested): Promise<PickCoreFilesStepResult> {
  await markJobPicking(pool, data.jobId);
  const existing = await getCoreFiles(pool, data.repo, data.sha);
  if (existing.length > 0) {
    await saveCoreFiles(pool, data.jobId, data.repo, data.sha, existing);
    return { status: 'picked', count: existing.length };
  }
  try {
    const { tree, sizes, truncated } = await fetchRepoTree(github, data.repo, data.sha);
    if (truncated) console.warn(`tree of ${data.repo}@${data.sha} is truncated by GitHub; the reader sees part of it`);
    const result = await pickCoreFiles({
      repo: data.repo,
      sha: data.sha,
      tree,
      sizes,
      readFile: cachedFileReader(pool, github, data.repo, data.sha),
      model: reader.model,
      limits: reader.limits,
      logCost: (reader.logCost ?? jobCostSink)(data.jobId, data.repo, data.sha),
      onDroppedPaths: (paths) => console.warn(`reader named paths that are not in ${data.repo}@${data.sha}: ${paths.join(', ')}`),
    });
    await saveCoreFiles(pool, data.jobId, data.repo, data.sha, result.coreFiles);
    return { status: 'picked', count: result.coreFiles.length };
  } catch (err) {
    if (err instanceof RateLimitError) {
      await markJobFailed(pool, data.jobId, 'rate-limited', err.resetAt);
      return { status: 'failed', reason: 'rate-limited' };
    }
    if (err instanceof ReaderInvalidOutputError) {
      await markJobFailed(pool, data.jobId, err.code);
      return { status: 'failed', reason: err.code };
    }
    throw err;
  }
}
