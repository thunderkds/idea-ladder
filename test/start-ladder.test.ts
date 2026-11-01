import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fixtureFetch, rateLimited, SHAS } from './helpers/github-fixture.js';
import { postStart, startTestApp, type TestApp } from './helpers/app.js';
import { RETURN_COOKIE } from '../src/app.js';
import { STATE_COOKIE } from '../src/auth/cookies.js';
import { startStub } from './stub-github.js';

const MITT = 'developit/mitt';

let t: TestApp;
let gh: ReturnType<typeof fixtureFetch>;
let cookie: string;
let oauth: { t: TestApp; stub: Awaited<ReturnType<typeof startStub>> };
let mode: { intercept?: (path: string, n: number) => Response | undefined } = {};

async function count(table: string): Promise<number> {
  return Number((await t.pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n);
}

beforeAll(async () => {
  t = await startTestApp({
    fetchImpl: ((...args: Parameters<typeof fetch>) => gh.fetch(...args)) as typeof fetch,
  });
  cookie = await t.signIn();
  const stub = await startStub({ clientId: 'test-client', clientSecret: 'test-secret' });
  oauth = { stub, t: await startTestApp({ oauthBaseUrl: stub.baseUrl, apiBaseUrl: stub.baseUrl }) };
});
afterAll(async () => {
  await oauth.stub.close();
  await oauth.t.close();
  await t.close();
});
beforeEach(async () => {
  gh = fixtureFetch('developit__mitt', (path, n) => mode.intercept?.(path, n));
  mode = {};
  t.events.length = 0;
  await t.pool.query('DELETE FROM generation_jobs');
  await t.pool.query('DELETE FROM ladders');
});

describe('POST /api/start', () => {
  it('cache hit on repo + SHA: 200 { ladderId }, no job, no event, one GitHub call', async () => {
    const { rows } = await t.pool.query<{ id: string }>(
      `INSERT INTO ladders (repo_full_name, commit_sha) VALUES ($1, $2) RETURNING id`,
      [MITT, SHAS.mitt],
    );
    const res = await postStart(t, cookie, { url: 'https://github.com/developit/mitt' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ladderId: rows[0]?.id });
    expect(t.events).toHaveLength(0);
    expect(await count('generation_jobs')).toBe(0);
    expect(gh.calls).toEqual(['/repos/developit/mitt/commits/HEAD']);
  });

  it('cache miss: 202 { jobId } and exactly one event { repo, sha, jobId }', async () => {
    const res = await postStart(t, cookie, { url: 'https://github.com/developit/mitt' });
    expect(res.status).toBe(202);
    const { jobId } = (await res.json()) as { jobId: string };
    expect(jobId).toMatch(/^[0-9a-f-]{36}$/);
    expect(t.events).toEqual([{ repo: MITT, sha: SHAS.mitt, jobId }]);
    expect(gh.calls).toHaveLength(1);
    const job = (await t.pool.query('SELECT status, started_by FROM generation_jobs WHERE id = $1', [jobId])).rows[0];
    expect(job.status).toBe('queued');
    expect(job.started_by).not.toBeNull();
  });

  it('sends the app token as a bearer header and never puts it in a response', async () => {
    let auth: string | null | undefined;
    mode.intercept = () => undefined;
    const inner = gh.fetch;
    const spy = (async (input: string | URL | Request, init?: RequestInit) => {
      auth = new Headers(init?.headers).get('authorization');
      return inner(input, init);
    }) as typeof fetch;
    const t2 = await startTestApp({ fetchImpl: spy });
    try {
      const c = await t2.signIn();
      const res = await postStart(t2, c, { url: 'developit/mitt' });
      expect(auth).toBe('Bearer test-app-token');
      expect(await res.text()).not.toContain('test-app-token');
    } finally {
      await t2.close();
    }
  });

  it('the same repo in another letter case shares one cache key and one job', async () => {
    const a = (await (await postStart(t, cookie, { url: 'https://github.com/Developit/Mitt' })).json()) as { jobId: string };
    const b = (await (await postStart(t, cookie, { url: 'developit/mitt' })).json()) as { jobId: string };
    expect(a.jobId).toBe(b.jobId);
    expect(await count('generation_jobs')).toBe(1);
    expect(t.events).toHaveLength(1);
    expect((await t.pool.query('SELECT repo_full_name FROM generation_jobs')).rows[0].repo_full_name).toBe(MITT);
  });

  it('concurrency: two parallel calls make one job and one event, both callers get the same jobId', async () => {
    const [r1, r2] = await Promise.all([
      postStart(t, cookie, { url: 'https://github.com/developit/mitt' }),
      postStart(t, cookie, { url: 'https://github.com/developit/mitt' }),
    ]);
    const b1 = (await r1.json()) as { jobId: string };
    const b2 = (await r2.json()) as { jobId: string };
    expect([r1.status, r2.status]).toEqual([202, 202]);
    expect(b1.jobId).toBe(b2.jobId);
    expect(await count('generation_jobs')).toBe(1);
    expect(t.events).toHaveLength(1);
  });

  it('many parallel calls still make one job', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => postStart(t, cookie, { url: 'https://github.com/developit/mitt' })),
    );
    const ids = new Set((await Promise.all(results.map((r) => r.json()))).map((b) => (b as { jobId: string }).jobId));
    expect(ids.size).toBe(1);
    expect(await count('generation_jobs')).toBe(1);
    expect(t.events).toHaveLength(1);
  });

  it('a failed job does not block a new job for the same repo + SHA', async () => {
    await t.pool.query(`INSERT INTO generation_jobs (repo_full_name, commit_sha, status, reason) VALUES ($1, $2, 'failed', 'rate-limited')`, [MITT, SHAS.mitt]);
    const res = await postStart(t, cookie, { url: 'developit/mitt' });
    expect(res.status).toBe(202);
    expect(await count('generation_jobs')).toBe(2);
    expect(t.events).toHaveLength(1);
  });

  it('a second call while a job is open returns the same jobId and sends no second event', async () => {
    const a = (await (await postStart(t, cookie, { url: 'developit/mitt' })).json()) as { jobId: string };
    const b = (await (await postStart(t, cookie, { url: 'developit/mitt' })).json()) as { jobId: string };
    expect(b.jobId).toBe(a.jobId);
    expect(t.events).toHaveLength(1);
  });

  it('a new SHA on an already-known repo is simply a miss', async () => {
    await t.pool.query(`INSERT INTO ladders (repo_full_name, commit_sha) VALUES ($1, $2)`, [MITT, 'a'.repeat(40)]);
    const res = await postStart(t, cookie, { url: 'developit/mitt' });
    expect(res.status).toBe(202);
  });

  it('repo 404: 404 { error: "repo-not-found" } and no job', async () => {
    mode.intercept = () => new Response('{"message":"Not Found"}', { status: 404 });
    const res = await postStart(t, cookie, { url: 'developit/mitt' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'repo-not-found' });
    expect(await count('generation_jobs')).toBe(0);
    expect(t.events).toHaveLength(0);
  });

  it('empty repo (GitHub 409): 422 { error: "repo-empty" } and no job', async () => {
    mode.intercept = () => new Response('{"message":"Git Repository is empty."}', { status: 409 });
    const res = await postStart(t, cookie, { url: 'developit/mitt' });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'repo-empty' });
    expect(await count('generation_jobs')).toBe(0);
  });

  it('rate limit while resolving the SHA: 503 { error: "rate-limited", resetAt }, retry-after, no job', async () => {
    const reset = Math.floor(Date.now() / 1000) + 600;
    mode.intercept = () => rateLimited(reset);
    const res = await postStart(t, cookie, { url: 'developit/mitt' });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'rate-limited', resetAt: new Date(reset * 1000).toISOString() });
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await count('generation_jobs')).toBe(0);
    expect(t.events).toHaveLength(0);
  });

  it('GitHub 5xx or a network error: 502 github-unavailable, no job', async () => {
    mode.intercept = () => new Response('', { status: 500 });
    const res = await postStart(t, cookie, { url: 'developit/mitt' });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'github-unavailable' });
    expect(await count('generation_jobs')).toBe(0);
  });

  it('unsupported URL: 422, and no GitHub call is made', async () => {
    for (const url of ['https://gitlab.com/o/n', 'javascript:alert(1)', 'https://github.com/o']) {
      const res = await postStart(t, cookie, { url });
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ error: 'unsupported-url' });
    }
    expect(gh.calls).toHaveLength(0);
  });

  it('missing, non-string or over-long url: 400', async () => {
    expect((await postStart(t, cookie, {})).status).toBe(400);
    expect((await postStart(t, cookie, { url: 42 })).status).toBe(400);
    expect((await postStart(t, cookie, 'not json')).status).toBe(400);
    const long = await postStart(t, cookie, { url: `https://github.com/o/${'n'.repeat(2100)}` });
    expect(long.status).toBe(400);
    expect(await long.json()).toEqual({ error: 'url-too-long' });
    expect(gh.calls).toHaveLength(0);
  });

  it('signed out: 401; wrong content type: 415', async () => {
    expect((await postStart(t, undefined, { url: 'developit/mitt' })).status).toBe(401);
    const form = await t.app.request('/api/start', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      body: 'url=developit/mitt',
    });
    expect(form.status).toBe(415);
    expect(gh.calls).toHaveLength(0);
  });

  it('when the event cannot be sent: 503, the job is marked failed (no stuck queued job)', async () => {
    const t2 = await startTestApp({
      fetchImpl: gh.fetch,
      enqueue: async () => {
        throw new Error('inngest is down');
      },
    });
    try {
      const c = await t2.signIn();
      const res = await postStart(t2, c, { url: 'developit/mitt' });
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: 'enqueue-failed' });
      const job = (await t2.pool.query('SELECT status, reason FROM generation_jobs')).rows[0];
      expect(job).toEqual({ status: 'failed', reason: 'enqueue-failed' });
    } finally {
      await t2.close();
    }
  });
});

describe('GET /start', () => {
  it('signed out: remembers the url and redirects to sign-in', async () => {
    const res = await t.app.request('/start?url=https%3A%2F%2Fgithub.com%2Fdevelopit%2Fmitt');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/auth/github');
    const setCookie = res.headers.getSetCookie().find((c) => c.startsWith(`${RETURN_COOKIE}=`));
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(gh.calls).toHaveLength(0);
  });

  async function oauthRoundTrip(cookies: string[], githubId: number) {
    const begin = await oauth.t.app.request('/auth/github');
    const state = new URL(begin.headers.get('location') as string).searchParams.get('state') as string;
    const stateCookie = begin.headers.getSetCookie().find((c) => c.startsWith(`${STATE_COOKIE}=`))?.split(';')[0] as string;
    const code = oauth.stub.issueCode({ id: githubId, login: `u${githubId}` });
    return oauth.t.app.request(`/auth/github/callback?code=${code}&state=${state}`, {
      headers: { cookie: [stateCookie, ...cookies].join('; ') },
    });
  }

  it('after sign-in the callback sends the learner back to the same /start?url=', async () => {
    const url = 'https://github.com/developit/mitt';
    const first = await oauth.t.app.request(`/start?url=${encodeURIComponent(url)}`);
    const returnCookie = first.headers.getSetCookie().find((c) => c.startsWith(`${RETURN_COOKIE}=`))?.split(';')[0] as string;
    const cb = await oauthRoundTrip([returnCookie], 77);
    expect(cb.status).toBe(302);
    expect(cb.headers.get('location')).toBe(`/start?url=${encodeURIComponent(url)}`);
  });

  it('a hostile return cookie cannot leave /start: the target is rebuilt, never copied', async () => {
    for (const evil of ['//evil.example/x', 'https://evil.example', '/\\evil.example']) {
      const cb = await oauthRoundTrip([`${RETURN_COOKIE}=${encodeURIComponent(evil)}`], 78);
      const location = cb.headers.get('location') as string;
      expect(location.startsWith('/start?url=')).toBe(true);
      expect(new URL(location, 'http://localhost:3000').origin).toBe('http://localhost:3000');
    }
    // Without the cookie the old behaviour stays.
    expect((await oauthRoundTrip([], 79)).headers.get('location')).toBe('/ladders');
  });

  it('signed in, miss: redirects to /jobs/:jobId', async () => {
    const res = await t.app.request('/start?url=https%3A%2F%2Fgithub.com%2Fdevelopit%2Fmitt', { headers: { cookie } });
    expect(res.status).toBe(302);
    const jobId = (await t.pool.query('SELECT id FROM generation_jobs')).rows[0].id;
    expect(res.headers.get('location')).toBe(`/jobs/${jobId}`);
    expect(t.events).toHaveLength(1);
  });

  it('signed in, hit: redirects to the ladder', async () => {
    const { rows } = await t.pool.query<{ id: string }>(`INSERT INTO ladders (repo_full_name, commit_sha) VALUES ($1, $2) RETURNING id`, [MITT, SHAS.mitt]);
    const res = await t.app.request('/start?url=developit%2Fmitt', { headers: { cookie } });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/ladders/${rows[0]?.id}`);
  });

  it('unsupported URL: a page that says so and shows the given URL escaped', async () => {
    const evil = 'https://gitlab.com/o/n?<script>alert(1)</script>';
    const res = await t.app.request(`/start?url=${encodeURIComponent(evil)}`, { headers: { cookie } });
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain('Only GitHub repository URLs work for now');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)');
    expect(gh.calls).toHaveLength(0);
  });

  it('missing or over-long url: 400 with a plain message', async () => {
    expect((await t.app.request('/start', { headers: { cookie } })).status).toBe(400);
    expect((await t.app.request(`/start?url=${'a'.repeat(2049)}`)).status).toBe(400);
  });

  it('repo not found: a plain page, not a stack trace', async () => {
    mode.intercept = () => new Response('{}', { status: 404 });
    const res = await t.app.request('/start?url=developit%2Fmitt', { headers: { cookie } });
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('no public repository');
  });
});
