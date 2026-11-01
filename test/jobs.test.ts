import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from './helpers/app.js';
import { SHAS } from './helpers/github-fixture.js';

let t: TestApp;
let cookie: string;
let otherCookie: string;

async function newJob(status: string, reason: string | null = null, resetAt: Date | null = null): Promise<string> {
  const { rows } = await t.pool.query<{ id: string }>(
    `INSERT INTO generation_jobs (repo_full_name, commit_sha, status, reason, reset_at) VALUES ('developit/mitt', $1, $2, $3, $4) RETURNING id`,
    [SHAS.mitt, status, reason, resetAt],
  );
  return (rows[0] as { id: string }).id;
}
const getApi = (id: string, c?: string) => t.app.request(`/api/jobs/${id}`, { headers: c ? { cookie: c } : {} });
const getPage = (id: string, c?: string) => t.app.request(`/jobs/${id}`, { headers: c ? { cookie: c } : {} });

beforeAll(async () => {
  t = await startTestApp();
  cookie = await t.signIn(1);
  otherCookie = await t.signIn(2);
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.pool.query('DELETE FROM generation_jobs');
  await t.pool.query('DELETE FROM ladders');
});

describe('GET /api/jobs/:jobId', () => {
  it.each(['queued', 'running', 'fetched'])('returns { status: %s }', async (status) => {
    const id = await newJob(status);
    const res = await getApi(id, cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status });
  });

  it('failed job: status, reason and the reset time', async () => {
    const reset = new Date(Date.now() + 600_000);
    const id = await newJob('failed', 'rate-limited', reset);
    expect(await (await getApi(id, cookie)).json()).toEqual({ status: 'failed', reason: 'rate-limited', resetAt: reset.toISOString() });
  });

  it('includes ladderId when a ladder exists for the same repo + SHA', async () => {
    const id = await newJob('fetched');
    const { rows } = await t.pool.query<{ id: string }>(`INSERT INTO ladders (repo_full_name, commit_sha) VALUES ('developit/mitt', $1) RETURNING id`, [SHAS.mitt]);
    expect(await (await getApi(id, cookie)).json()).toEqual({ status: 'fetched', ladderId: rows[0]?.id });
  });

  it('another signed-in learner can read the same job (they wait on the same repo + SHA)', async () => {
    const id = await newJob('running');
    expect((await getApi(id, otherCookie)).status).toBe(200);
  });

  it('unknown id and a malformed id: 404', async () => {
    expect((await getApi('00000000-0000-4000-8000-000000000000', cookie)).status).toBe(404);
    expect((await getApi('not-a-uuid', cookie)).status).toBe(404);
    expect((await getApi("1'; DROP TABLE generation_jobs;--", cookie)).status).toBe(404);
  });

  it('signed out: 401', async () => {
    const id = await newJob('queued');
    expect((await getApi(id)).status).toBe(401);
  });
});

describe('GET /jobs/:jobId', () => {
  it('signed out: redirects to the home page', async () => {
    const res = await getPage(await newJob('queued'));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');
  });

  it('unknown id: a 404 page', async () => {
    expect((await getPage('00000000-0000-4000-8000-000000000000', cookie)).status).toBe(404);
  });

  it.each([
    ['queued', 'Queued', true],
    ['running', 'Reading the repo', true],
    ['fetched', 'Done', false],
  ])('%s shows "%s"; the polling script is present only while not final (%s)', async (status, heading, polls) => {
    const id = await newJob(status);
    const html = await (await getPage(id, cookie)).text();
    expect(html).toContain(`<h1 id="job-status">${heading}</h1>`);
    expect(html).toContain('developit/mitt');
    expect(html.includes('/assets/job-status.js')).toBe(polls);
    if (polls) expect(html).toContain(`data-job-id="${id}"`);
  });

  it('failed + rate-limited: "Failed: rate-limited", the reset time in plain words, no polling, no raw JSON or stack', async () => {
    const id = await newJob('failed', 'rate-limited', new Date('2026-11-01T14:05:30Z'));
    const html = await (await getPage(id, cookie)).text();
    expect(html).toContain('<h1 id="job-status">Failed: rate-limited</h1>');
    expect(html).toContain('2026-11-01 14:05 UTC');
    expect(html).toContain('Try again');
    expect(html).not.toContain('/assets/job-status.js');
    expect(html).not.toMatch(/\bat \S+ \(|node_modules|\{"status"/);
  });

  it('failed + other reasons get a plain sentence', async () => {
    const html = await (await getPage(await newJob('failed', 'repo-not-found'), cookie)).text();
    expect(html).toContain('Failed: repo-not-found');
    expect(html).toContain('no public repository');
  });
});
