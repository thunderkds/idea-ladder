import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RETURN_COOKIE, RETURN_LADDER_COOKIE } from '../src/app.js';
import { getLadderView, listMyLadders } from '../src/ladder/view.js';
import { LadderPage } from '../src/views.js';
import { startTestApp, type TestApp } from './helpers/app.js';
import { SHAS } from './helpers/github-fixture.js';

let t: TestApp;
let cookie: string;
let userA: string;
let userB: string;
let cookieB: string;

const MITT = 'developit/mitt';
const UNKNOWN = '00000000-0000-4000-8000-000000000000';

async function newLadder(repo = MITT, sha: string = SHAS.mitt): Promise<string> {
  const { rows } = await t.pool.query<{ id: string }>(`INSERT INTO ladders (repo_full_name, commit_sha) VALUES ($1, $2) RETURNING id`, [repo, sha]);
  return (rows[0] as { id: string }).id;
}
async function newJob(repo: string, sha: string, startedBy: string | null) {
  await t.pool.query(`INSERT INTO generation_jobs (repo_full_name, commit_sha, status, started_by) VALUES ($1, $2, 'fetched', $3)`, [repo, sha, startedBy]);
  if (startedBy) await t.pool.query(`INSERT INTO ladder_learners (user_id, repo_full_name, commit_sha) VALUES ($1, $2, $3)`, [startedBy, repo, sha]);
}
const get = (path: string, c?: string) => t.app.request(path, { headers: c ? { cookie: c } : {}, redirect: 'manual' });
async function userIdOf(githubId: number): Promise<string> {
  const { rows } = await t.pool.query<{ id: string }>('SELECT id FROM users WHERE github_id = $1', [githubId]);
  return (rows[0] as { id: string }).id;
}

beforeAll(async () => {
  t = await startTestApp();
  cookie = await t.signIn(1);
  cookieB = await t.signIn(2);
  userA = await userIdOf(1);
  userB = await userIdOf(2);
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.pool.query('DROP TABLE IF EXISTS levels');
  await t.pool.query('DELETE FROM ladder_learners');
  await t.pool.query('DELETE FROM generation_jobs');
  await t.pool.query('DELETE FROM ladders');
});

describe('getLadderView', () => {
  it('ladder with no level rows: five fixed levels with "Not generated yet" goals, L0 open', async () => {
    const id = await newLadder();
    const view = await getLadderView(t.pool, id, userA);
    expect(view).toMatchObject({ repoFullName: MITT, commitSha: SHAS.mitt, status: 'unverified' });
    expect(view?.levels.map((l) => [l.id, l.title, l.goal, l.lock])).toEqual([
      ['L0', 'Prerequisites', 'Not generated yet', 'open'],
      ['L1', 'Run it', 'Not generated yet', 'locked'],
      ['L2', 'Modify', 'Not generated yet', 'locked'],
      ['L3', 'Understand', 'Not generated yet', 'locked'],
      ['L4', 'Rebuild or contribute', 'Not generated yet', 'locked'],
    ]);
    expect(view?.levels[1]?.passTest).toEqual({ kind: 'run-log-and-explanation', description: 'Screenshot or log + 3-sentence explanation' });
  });

  it('uses level rows when the table has them, incl. the concept-only-skipped kind', async () => {
    const id = await newLadder();
    await t.pool.query(`CREATE TABLE levels (ladder_id uuid, level_id text, goal text, pass_test_kind text, pass_test_description text)`);
    await t.pool.query(
      `INSERT INTO levels VALUES ($1, 'L0', 'Know event emitters', 'concept-mcq', '8 concept questions'),
                                 ($1, 'L1', 'ignored', 'concept-only-skipped', 'ignored')`,
      [id],
    );
    const view = await getLadderView(t.pool, id, userA);
    expect(view?.levels[0]).toMatchObject({ goal: 'Know event emitters', passTest: { kind: 'concept-mcq', description: '8 concept questions' } });
    expect(view?.levels[1]?.goal).toBe('Concept-only ladder: this level is not generated for this repo');
    expect(view?.levels[2]?.goal).toBe('Not generated yet');
  });

  it("lock state is per learner: B's passes do not change A's view", async () => {
    const id = await newLadder();
    const readPassed = async (_p: unknown, user: string) => (user === userB ? ['L0', 'L1'] : []);
    expect((await getLadderView(t.pool, id, userA, { readPassed }))?.levels.map((l) => l.lock)).toEqual(['open', 'locked', 'locked', 'locked', 'locked']);
    expect((await getLadderView(t.pool, id, userB, { readPassed }))?.levels.map((l) => l.lock)).toEqual(['passed', 'passed', 'open', 'locked', 'locked']);
  });

  it('unknown or malformed id gives null', async () => {
    expect(await getLadderView(t.pool, UNKNOWN, userA)).toBeNull();
    expect(await getLadderView(t.pool, 'does-not-exist', userA)).toBeNull();
  });
});

describe('GET /ladders/:ladderId', () => {
  it('shows 5 levels in order, Unverified badge with description, 7-char SHA, and the two link-outs', async () => {
    const id = await newLadder();
    const res = await get(`/ladders/${id}`, cookie);
    expect(res.status).toBe(200);
    const html = await res.text();
    const order = ['L0 Prerequisites', 'L1 Run it', 'L2 Modify', 'L3 Understand', 'L4 Rebuild or contribute'].map((s) => html.indexOf(s));
    expect(order.every((n, i) => n > 0 && (i === 0 || n > (order[i - 1] as number)))).toBe(true);
    expect(html).toContain('Unverified');
    expect(html).toContain('AI-drafted, not yet reviewed by people');
    expect(html).toContain('<code>6b41670</code>');
    expect(html).toContain(`href="https://github.com/developit/mitt/blob/${SHAS.mitt}/README.md"`);
    expect(html).toContain('href="https://deepwiki.com/developit/mitt"');
    expect(html.match(/rel="noopener noreferrer"/g)).toHaveLength(2);
    expect(html.match(/target="_blank"/g)).toHaveLength(2);
    expect(html).toContain('Locked — pass L0 first');
    expect(html).toContain('Locked — pass L3 first');
    expect(html.match(/aria-disabled="true"/g)).toHaveLength(4);
  });

  it('encodes repo names with dots and dashes in the links and escapes HTML in names', async () => {
    const id = await newLadder('vercel/next.js', SHAS.mitt);
    const html = await (await get(`/ladders/${id}`, cookie)).text();
    expect(html).toContain('https://deepwiki.com/vercel/next.js');
    const hostile = await newLadder('<b>x/y"z', '0'.repeat(40));
    const bad = await (await get(`/ladders/${hostile}`, cookie)).text();
    expect(bad).not.toContain('<b>');
    expect(bad).toContain('https://deepwiki.com/%3Cb%3Ex/y%22z');
  });

  it('unknown ladder id: 404 page; malformed id: 404 page', async () => {
    for (const id of [UNKNOWN, 'does-not-exist']) {
      const res = await get(`/ladders/${id}`, cookie);
      expect(res.status).toBe(404);
      expect(await res.text()).toContain('Ladder not found');
    }
  });

  it('signed out: redirect to sign-in, then back to the same ladder after the callback', async () => {
    const id = await newLadder();
    const res = await get(`/ladders/${id}`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/auth/github');
    expect(res.headers.get('set-cookie')).toContain(`${RETURN_LADDER_COOKIE}=${id}`);
  });

  it('the newest return target wins: opening a ladder clears an older /start target, and the reverse', async () => {
    const id = await newLadder();
    const ladder = await get(`/ladders/${id}`, `${RETURN_COOKIE}=lukeed%2Fdset`);
    expect(ladder.headers.getSetCookie().find((c) => c.startsWith(`${RETURN_COOKIE}=`))).toMatch(/Max-Age=0/i);

    const start = await get('/start?url=developit%2Fmitt', `${RETURN_LADDER_COOKIE}=${id}`);
    expect(start.headers.getSetCookie().find((c) => c.startsWith(`${RETURN_LADDER_COOKIE}=`))).toMatch(/Max-Age=0/i);
  });

  it('a ladder saved for one learner shows for another, with the same levels', async () => {
    const id = await newLadder();
    await newJob(MITT, SHAS.mitt, userA);
    const a = await (await get(`/ladders/${id}`, cookie)).text();
    const b = await (await get(`/ladders/${id}`, cookieB)).text();
    expect(b).toContain('L4 Rebuild or contribute');
    expect(b).toContain('Not generated yet');
    expect(a).toContain('user1');
    expect(b).toContain('user2');
  });
});

describe('LadderPage lock rendering', () => {
  it('L0 and L1 passed: shows Passed twice, L2 open, L3 and L4 locked', async () => {
    const id = await newLadder();
    const ladder = await getLadderView(t.pool, id, userA, { readPassed: async () => ['L0', 'L1'] });
    const html = String(LadderPage({ login: 'u', ladder: ladder! }));
    expect(html.match(/level-passed/g)).toHaveLength(2);
    expect(html.match(/level-open/g)).toHaveLength(1);
    expect(html.match(/aria-disabled="true"/g)).toHaveLength(2);
    expect(html).toContain('Locked — pass L2 first');
    expect(html).not.toContain('Locked — pass L1 first');
  });
});

describe('My ladders list', () => {
  it('lists ladders whose job the learner started, newest first; others do not see them; empty state stays', async () => {
    const empty = await (await get('/ladders', cookie)).text();
    expect(empty).toContain('No ladders yet');
    const one = await newLadder(MITT, SHAS.mitt);
    const two = await newLadder('lukeed/dset', '1'.repeat(40));
    await newJob(MITT, SHAS.mitt, userA);
    await newJob('lukeed/dset', '1'.repeat(40), userA);
    expect((await listMyLadders(t.pool, userA)).map((l) => l.id)).toEqual([two, one]);
    const html = await (await get('/ladders', cookie)).text();
    expect(html).not.toContain('No ladders yet');
    expect(html).toContain(`href="/ladders/${one}"`);
    expect(html).toContain(`href="/ladders/${two}"`);
    expect(html.match(/Open ladder/g)).toHaveLength(2);
    const other = await (await get('/ladders', cookieB)).text();
    expect(other).toContain('No ladders yet');
  });

  it('a job with no saved ladder yet is not listed', async () => {
    await newJob(MITT, SHAS.mitt, userA);
    expect(await listMyLadders(t.pool, userA)).toEqual([]);
  });
});
