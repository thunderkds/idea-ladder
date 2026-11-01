import { InngestTestEngine } from '@inngest/test';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { confidenceScore } from '../src/start/confidence.js';
import { LADDER_REQUESTED } from '../src/start/service.js';
import { createLadderGenerate, fetchRepo } from '../src/workflow/ladder-generate.js';
import { startTestApp, type TestApp } from './helpers/app.js';
import { API, fixtureFetch, rateLimited, SHAS } from './helpers/github-fixture.js';

let t: TestApp;
let pool: pg.Pool;
let jobId: string;

async function newJob(repo: string, sha: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO generation_jobs (repo_full_name, commit_sha) VALUES ($1, $2) RETURNING id`,
    [repo, sha],
  );
  return (rows[0] as { id: string }).id;
}
const job = async () => (await pool.query('SELECT status, reason, reset_at FROM generation_jobs WHERE id = $1', [jobId])).rows[0];
const count = async (table: string) => Number((await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n);

function engine(fetchImpl: typeof fetch, repo: string, sha: string) {
  const fn = createLadderGenerate(pool, { baseUrl: API, token: 'test-app-token', fetchImpl });
  return new InngestTestEngine({
    function: fn,
    events: [{ name: LADDER_REQUESTED, data: { repo, sha, jobId } }],
  });
}

beforeAll(async () => {
  t = await startTestApp();
  pool = t.pool;
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await pool.query('DELETE FROM repo_snapshots');
  await pool.query('DELETE FROM generation_jobs');
});

describe('ladder-generate / fetch-repo', () => {
  it('stores the snapshot and the confidence for lukeed/dset and ends the job `fetched`', async () => {
    jobId = await newJob('lukeed/dset', SHAS.dset);
    const gh = fixtureFetch('lukeed__dset');
    const { result } = await engine(gh.fetch, 'lukeed/dset', SHAS.dset).execute();
    expect(result).toEqual({ status: 'fetched' });

    const snap = (await pool.query('SELECT * FROM repo_snapshots')).rows;
    expect(snap).toHaveLength(1);
    expect(snap[0].commit_sha).toMatch(/^[0-9a-f]{40}$/);
    expect(snap[0].commit_sha).toBe(SHAS.dset);
    expect(snap[0].repo_full_name).toBe('lukeed/dset');
    expect(snap[0].default_branch).toBe('master');
    expect(snap[0].archived).toBe(false);
    expect(snap[0].readme.length).toBeGreaterThan(1500);
    expect(snap[0].topics).toEqual([]);
    expect(snap[0].languages).toEqual({ JavaScript: 17856 });
    expect(snap[0].dep_files).toEqual(['package.json']);
    expect(snap[0].open_issues).toBe(8);
    expect(snap[0].good_first_issues).toBe(0);
    expect(snap[0].tree.length).toBeGreaterThan(3);
    expect(snap[0].tree[0]).toEqual({ path: expect.any(String), type: expect.stringMatching(/^(file|dir|other)$/) });

    const conf = (await pool.query('SELECT * FROM repo_confidence')).rows;
    expect(conf).toHaveLength(1);
    expect(Number(conf[0].score)).toBe(0.9);
    expect(conf[0].level).toBe('high');
    expect(conf[0].fallback_to_concepts).toBe(false);
    expect(conf[0].reasons).toEqual(['0 good first issue (-0.1)']);

    expect((await job()).status).toBe('fetched');
    // 6 reads, every one pinned to the SHA or scoped to the repo; the commit SHA was not re-resolved.
    expect(gh.calls).toHaveLength(6);
    expect(gh.calls.filter((c) => c.includes('?ref='))).toEqual(
      expect.arrayContaining([`/repos/lukeed/dset/readme?ref=${SHAS.dset}`, `/repos/lukeed/dset/contents/?ref=${SHAS.dset}`]),
    );
  });

  it('the job is `running` while the step reads, then `fetched`', async () => {
    jobId = await newJob('developit/mitt', SHAS.mitt);
    let statusDuringRead: string | undefined;
    const gh = fixtureFetch('developit__mitt', (path) => {
      if (path.includes('/languages')) void job().then((j) => (statusDuringRead = j.status));
      return undefined;
    });
    await fetchRepo(pool, { baseUrl: API, fetchImpl: gh.fetch }, { repo: 'developit/mitt', sha: SHAS.mitt, jobId });
    await new Promise((r) => setTimeout(r, 20));
    expect(statusDuringRead).toBe('running');
    expect((await job()).status).toBe('fetched');
  });

  it('a snapshot is matched by the ported confidence rule (low README, no issues, no deps -> low + concept fallback)', () => {
    const c = confidenceScore({ readme: 'tiny', openIssues: 0, goodFirstIssues: 0, depFiles: [] });
    expect(c).toMatchObject({ score: 0, level: 'low', fallbackToConcepts: true });
    expect(c.reasons).toHaveLength(4);
    expect(confidenceScore({ readme: 'x'.repeat(1500), openIssues: 3, goodFirstIssues: 1, depFiles: ['go.mod'] })).toMatchObject({
      score: 1,
      level: 'high',
      reasons: ['no penalties'],
    });
    expect(confidenceScore({ readme: 'x'.repeat(1500), openIssues: 0, goodFirstIssues: 1, depFiles: [] })).toMatchObject({
      score: 0.5,
      level: 'medium',
    });
  });

  it('rate limit in the step: job `failed` / `rate-limited` with the reset time, and no snapshot row', async () => {
    jobId = await newJob('lukeed/dset', SHAS.dset);
    const reset = Math.floor(Date.now() / 1000) + 900;
    const gh = fixtureFetch('lukeed__dset', (path) => (path.includes('/languages') ? rateLimited(reset) : undefined));
    const { result } = await engine(gh.fetch, 'lukeed/dset', SHAS.dset).execute();
    expect(result).toEqual({ status: 'failed', reason: 'rate-limited' });
    const j = await job();
    expect(j.status).toBe('failed');
    expect(j.reason).toBe('rate-limited');
    expect(new Date(j.reset_at).getTime()).toBe(reset * 1000);
    expect(await count('repo_snapshots')).toBe(0);
    expect(await count('repo_confidence')).toBe(0);
  });

  it('a 429 rate limit is handled the same way', async () => {
    jobId = await newJob('lukeed/dset', SHAS.dset);
    const gh = fixtureFetch('lukeed__dset', (path) =>
      path.includes('/issues') ? new Response('{}', { status: 429, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '4000000000' } }) : undefined,
    );
    await fetchRepo(pool, { baseUrl: API, fetchImpl: gh.fetch }, { repo: 'lukeed/dset', sha: SHAS.dset, jobId });
    expect((await job()).reason).toBe('rate-limited');
    expect(await count('repo_snapshots')).toBe(0);
  });

  it('repo gone by the time the step runs: job `failed` / `repo-not-found`, no snapshot', async () => {
    jobId = await newJob('lukeed/dset', SHAS.dset);
    const gh = fixtureFetch('lukeed__dset', (path) => (path === '/repos/lukeed/dset' ? new Response('{}', { status: 404 }) : undefined));
    const { result } = await engine(gh.fetch, 'lukeed/dset', SHAS.dset).execute();
    expect(result).toEqual({ status: 'failed', reason: 'repo-not-found' });
    expect(await count('repo_snapshots')).toBe(0);
  });

  it('a 5xx mid-read throws (so Inngest retries the step), leaves the job `running` and writes no partial snapshot', async () => {
    jobId = await newJob('lukeed/dset', SHAS.dset);
    const gh = fixtureFetch('lukeed__dset', (path) => (path.includes('/issues?') ? new Response('', { status: 502 }) : undefined));
    await expect(fetchRepo(pool, { baseUrl: API, fetchImpl: gh.fetch }, { repo: 'lukeed/dset', sha: SHAS.dset, jobId })).rejects.toThrow(/502/);
    expect((await job()).status).toBe('running');
    expect(await count('repo_snapshots')).toBe(0);
  });

  it('retry: the step fails once with a 5xx, the next attempt finishes `fetched`; only fetch-repo runs again', async () => {
    jobId = await newJob('lukeed/dset', SHAS.dset);
    let failed = false;
    const gh = fixtureFetch('lukeed__dset', (path) => {
      if (!failed && path === '/repos/lukeed/dset') {
        failed = true;
        return new Response('', { status: 503 });
      }
      return undefined;
    });
    const t1 = engine(gh.fetch, 'lukeed/dset', SHAS.dset);
    const first = await t1.execute();
    expect(first.error).toBeTruthy();
    expect((await job()).status).toBe('running');

    const second = await t1.execute();
    expect(second.result).toEqual({ status: 'fetched' });
    expect((await job()).status).toBe('fetched');
    expect(await count('repo_snapshots')).toBe(1);
    // The service (not the function) sends the event, and it ran zero times here.
    expect(t.events).toHaveLength(0);
  });

  it('refuses a repo name that is not owner/name or has a dot-dot segment, without any GitHub call', async () => {
    jobId = await newJob('lukeed/dset', SHAS.dset);
    const gh = fixtureFetch('lukeed__dset');
    for (const repo of ['../etc', 'lukeed/..', 'a/b/c', 'lukeed']) {
      await expect(fetchRepo(pool, { baseUrl: API, fetchImpl: gh.fetch }, { repo, sha: SHAS.dset, jobId })).rejects.toThrow(/expected owner\/name/);
    }
    expect(gh.calls).toHaveLength(0);
  });

  it('running the step twice for one repo + SHA leaves one snapshot row', async () => {
    jobId = await newJob('developit/mitt', SHAS.mitt);
    const gh = fixtureFetch('developit__mitt');
    const deps = { baseUrl: API, fetchImpl: gh.fetch };
    await fetchRepo(pool, deps, { repo: 'developit/mitt', sha: SHAS.mitt, jobId });
    await fetchRepo(pool, deps, { repo: 'developit/mitt', sha: SHAS.mitt, jobId });
    expect(await count('repo_snapshots')).toBe(1);
    expect(await count('repo_confidence')).toBe(1);
  });
});
