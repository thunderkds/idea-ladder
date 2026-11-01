import { InngestTestEngine } from '@inngest/test';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cachedFileReader, fetchRepoTree } from '../src/reader/github-files.js';
import { getCoreFiles } from '../src/reader/core-files.js';
import { DEFAULT_LIMITS, STEP_NAME, type ReaderCall } from '../src/reader/repo-reader.js';
import { LADDER_REQUESTED } from '../src/start/service.js';
import { createLadderGenerate } from '../src/workflow/ladder-generate.js';
import { startTestApp, type TestApp } from './helpers/app.js';
import { API, fixtureFetch, rateLimited, SHAS } from './helpers/github-fixture.js';
import { answer, scriptedModel } from './helpers/mock-model.js';

let t: TestApp;
let pool: pg.Pool;
let jobId: string;

// The repo behind the fixture: what the reader's tree and contents calls see at SHAS.dset.
const REPO_FILES: Record<string, string> = {
  'readme.md': '# dset\n',
  'package.json': '{"main":"dist/dset.js"}\n',
  'src/index.js': 'export default function dset() {}\n',
  'src/util.js': 'export const u = 1;\n',
};

/** fetch-repo answers come from the recorded T001 fixture; the reader's tree and file reads come from REPO_FILES. */
function githubWithRepo(intercept?: (path: string) => Response | undefined) {
  const base = fixtureFetch('lukeed__dset', intercept);
  const readerCalls: string[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input).slice(API.length);
    const fail = intercept?.(path);
    if (path.startsWith(`/repos/lukeed/dset/git/trees/${SHAS.dset}`)) {
      readerCalls.push(path);
      if (fail) return fail;
      return Response.json({ truncated: false, tree: Object.entries(REPO_FILES).map(([p, text]) => ({ path: p, type: 'blob', size: text.length })) });
    }
    const file = /^\/repos\/lukeed\/dset\/contents\/([^?]+)\?ref=/.exec(path);
    if (file) {
      readerCalls.push(path);
      if (fail) return fail;
      const text = REPO_FILES[decodeURIComponent(file[1]!)];
      if (text === undefined) return new Response('{}', { status: 404 });
      return Response.json({ type: 'file', encoding: 'base64', content: Buffer.from(text).toString('base64') });
    }
    return base.fetch(input, init);
  }) as typeof fetch;
  return { fetch: impl, base, readerCalls };
}

const GOOD = answer(['src/index.js', 'the single entry point'], ['package.json', 'names the built entry'], ['src/util.js', 'helper']);
const script = [{ tool: 'list', input: { path: '' } }, { tool: 'read', input: { path: 'src/index.js' } }, GOOD] as const;

function engine(fetchImpl: typeof fetch, model = scriptedModel([...script]), logged: ReaderCall[] = []) {
  const fn = createLadderGenerate(pool, { baseUrl: API, token: 'test-app-token', fetchImpl }, {
    model,
    limits: DEFAULT_LIMITS,
    logCost: () => (call) => void logged.push(call),
  });
  return new InngestTestEngine({ function: fn, events: [{ name: LADDER_REQUESTED, data: { repo: 'lukeed/dset', sha: SHAS.dset, jobId } }] });
}
const job = async () => (await pool.query('SELECT status, reason FROM generation_jobs WHERE id = $1', [jobId])).rows[0];

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
  await pool.query('DELETE FROM repo_file_cache');
  jobId = (await pool.query<{ id: string }>(`INSERT INTO generation_jobs (repo_full_name, commit_sha) VALUES ('lukeed/dset', $1) RETURNING id`, [SHAS.dset])).rows[0]!.id;
});

describe('ladder-generate / pick-core-files (AC 5, 6)', () => {
  it('runs after fetch-repo, stores ranked core_files for repo + SHA, ends the job `picked`, and logs each model call', async () => {
    const gh = githubWithRepo();
    const logged: ReaderCall[] = [];
    let statusDuringPick: string | undefined;
    const model = scriptedModel((n) => {
      if (n === 0) void job().then((j) => (statusDuringPick = j.status));
      return script[Math.min(n, 2)]!;
    });
    const { result } = await engine(gh.fetch, model, logged).execute();
    expect(result).toEqual({ status: 'picked', count: 3 });

    expect(await getCoreFiles(pool, 'lukeed/dset', SHAS.dset)).toEqual([
      { rank: 1, path: 'src/index.js', reason: 'the single entry point' },
      { rank: 2, path: 'package.json', reason: 'names the built entry' },
      { rank: 3, path: 'src/util.js', reason: 'helper' },
    ]);
    expect(statusDuringPick).toBe('picking');
    expect(await job()).toMatchObject({ status: 'picked', reason: null });
    expect(logged).toHaveLength(3);
    expect(logged[0]).toMatchObject({ model: 'test-model', inputTokens: 100, outputTokens: 20 });
    // the file the reader read is cached for this repo + SHA
    const cached = await pool.query('SELECT path, kind FROM repo_file_cache');
    expect(cached.rows).toEqual([{ path: 'src/index.js', kind: 'text' }]);
  });

  it('when pick-core-files throws once, the retry runs only that step: fetch-repo reads nothing again', async () => {
    const gh = githubWithRepo();
    let calls = 0;
    const model = scriptedModel((n) => {
      calls++;
      if (n === 1) return { throws: new Error('overloaded') }; // after list, before read
      return script[Math.min(calls <= 2 ? n : n - 1, 2)]!;
    });
    const t1 = engine(gh.fetch, model);
    const first = await t1.execute();
    expect(first.error).toBeTruthy();
    expect(await job()).toMatchObject({ status: 'picking' });
    const metaCallsBefore = gh.base.calls.length;
    expect(metaCallsBefore).toBeGreaterThan(0);

    // Inngest hands the finished fetch-repo result back; only pick-core-files runs.
    const fetched = await first.state['fetch-repo'];
    const second = await t1.execute({ steps: [{ id: 'fetch-repo', handler: () => fetched }] });
    expect(second.result).toEqual({ status: 'picked', count: 3 });
    expect(gh.base.calls).toHaveLength(metaCallsBefore); // fetch-repo made no new GitHub call
    expect((await getCoreFiles(pool, 'lukeed/dset', SHAS.dset)).map((f) => f.rank)).toEqual([1, 2, 3]);
    expect(await job()).toMatchObject({ status: 'picked' });
  });

  it('a second job for the same commit reuses the stored core files and makes no model call', async () => {
    const gh = githubWithRepo();
    await engine(gh.fetch).execute();
    await pool.query(`UPDATE generation_jobs SET status = 'failed' WHERE id = $1`, [jobId]);
    jobId = (await pool.query<{ id: string }>(`INSERT INTO generation_jobs (repo_full_name, commit_sha) VALUES ('lukeed/dset', $1) RETURNING id`, [SHAS.dset])).rows[0]!.id;
    const model = scriptedModel([{ throws: new Error('must not be called') }]);
    const { result } = await engine(gh.fetch, model).execute();
    expect(result).toEqual({ status: 'picked', count: 3 });
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(await pool.query('SELECT 1 FROM core_files')).toHaveProperty('rowCount', 3);
  });

  it('an answer the reader cannot make valid ends the job `failed` / `reader-invalid-output`, no core_files, no retry', async () => {
    const gh = githubWithRepo();
    const bad = answer(['src/index.js', 'real'], ['ghost.js', 'invented'], ['ghost2.js', 'invented']);
    const model = scriptedModel([bad]);
    const { result } = await engine(gh.fetch, model).execute();
    expect(result).toEqual({ status: 'failed', reason: 'reader-invalid-output' });
    expect(await job()).toMatchObject({ status: 'failed', reason: 'reader-invalid-output' });
    expect(await pool.query('SELECT 1 FROM core_files')).toHaveProperty('rowCount', 0);
  });

  it('a GitHub rate limit while the reader reads ends the job `failed` / `rate-limited`', async () => {
    const reset = Math.floor(Date.now() / 1000) + 900;
    const gh = githubWithRepo((path) => (path.includes('/git/trees/') ? rateLimited(reset) : undefined));
    const { result } = await engine(gh.fetch).execute();
    expect(result).toEqual({ status: 'failed', reason: 'rate-limited' });
    expect(await job()).toMatchObject({ status: 'failed', reason: 'rate-limited' });
  });

  it('a failed fetch-repo skips pick-core-files', async () => {
    const gh = githubWithRepo((path) => (path === '/repos/lukeed/dset' ? new Response('{}', { status: 404 }) : undefined));
    const model = scriptedModel([{ throws: new Error('must not be called') }]);
    const { result } = await engine(gh.fetch, model).execute();
    expect(result).toEqual({ status: 'failed', reason: 'repo-not-found' });
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it('without reader deps the function stops after fetch-repo, as before', async () => {
    const gh = githubWithRepo();
    const fn = createLadderGenerate(pool, { baseUrl: API, token: 'x', fetchImpl: gh.fetch });
    const e = new InngestTestEngine({ function: fn, events: [{ name: LADDER_REQUESTED, data: { repo: 'lukeed/dset', sha: SHAS.dset, jobId } }] });
    expect((await e.execute()).result).toEqual({ status: 'fetched' });
    expect(STEP_NAME).toBe('pick-core-files');
  });
});

describe('job page and migration', () => {
  it('shows "Picking core files" while the job is `picking`', async () => {
    await pool.query(`UPDATE generation_jobs SET status = 'picking' WHERE id = $1`, [jobId]);
    const cookie = await t.signIn();
    const res = await t.app.request(`/jobs/${jobId}`, { headers: { cookie } });
    expect(await res.text()).toContain('Picking core files');
    await pool.query(`UPDATE generation_jobs SET status = 'picked' WHERE id = $1`, [jobId]);
    const done = await t.app.request(`/jobs/${jobId}`, { headers: { cookie } });
    expect(await done.text()).not.toContain('This page updates by itself');
  });
});

describe('GitHub-backed files (AC 4, edge cases)', () => {
  it('reads each path once per repo + SHA: the second read comes from Postgres; binary files are cached as binary', async () => {
    const gh = githubWithRepo();
    const github = { baseUrl: API, fetchImpl: gh.fetch };
    const read = cachedFileReader(pool, github, 'lukeed/dset', SHAS.dset);
    expect(await read('src/index.js')).toEqual({ kind: 'text', text: REPO_FILES['src/index.js'] });
    expect(await read('src/index.js')).toEqual({ kind: 'text', text: REPO_FILES['src/index.js'] });
    expect(gh.readerCalls.filter((c) => c.includes('/contents/'))).toHaveLength(1);
    REPO_FILES['logo.bin'] = 'ab\0cd';
    try {
      expect(await read('logo.bin')).toEqual({ kind: 'binary' });
      expect(await read('logo.bin')).toEqual({ kind: 'binary' });
      expect((await pool.query("SELECT content FROM repo_file_cache WHERE path = 'logo.bin'")).rows).toEqual([{ content: null }]);
    } finally {
      delete REPO_FILES['logo.bin'];
    }
  });

  it('a 5xx from GitHub is thrown (so the step is retried) and nothing is cached', async () => {
    const gh = githubWithRepo((p) => (p.includes('/contents/') ? new Response('', { status: 502 }) : undefined));
    const read = cachedFileReader(pool, { baseUrl: API, fetchImpl: gh.fetch }, 'lukeed/dset', SHAS.dset);
    await expect(read('src/index.js')).rejects.toThrow(/502/);
    expect(await pool.query('SELECT 1 FROM repo_file_cache')).toHaveProperty('rowCount', 0);
  });

  it('refuses a repo name with a dot-dot segment or a SHA that is not 40-hex, without any GitHub call', async () => {
    const gh = githubWithRepo();
    const github = { baseUrl: API, fetchImpl: gh.fetch };
    await expect(fetchRepoTree(github, 'lukeed/..', SHAS.dset)).rejects.toThrow(/expected owner\/name/);
    await expect(fetchRepoTree(github, 'lukeed/dset', 'main')).rejects.toThrow(/40-hex/);
    expect(() => cachedFileReader(pool, github, '../x', SHAS.dset)).toThrow(/expected owner\/name/);
    expect(gh.readerCalls).toHaveLength(0);
  });

  it('the tree comes from one call, blobs only, with sizes', async () => {
    const gh = githubWithRepo();
    const tree = await fetchRepoTree({ baseUrl: API, fetchImpl: gh.fetch }, 'lukeed/dset', SHAS.dset);
    expect(tree.tree).toEqual(Object.keys(REPO_FILES));
    expect(tree.sizes.get('src/util.js')).toBe(REPO_FILES['src/util.js']!.length);
    expect(tree.truncated).toBe(false);
    expect(gh.readerCalls).toEqual([`/repos/lukeed/dset/git/trees/${SHAS.dset}?recursive=1`]);
  });
});
