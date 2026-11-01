import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { listMyLadders } from '../src/ladder/view.js';
import { postStart, startTestApp, type TestApp } from './helpers/app.js';
import { createTempDb, runMigrate } from './helpers/db.js';
import { fixtureFetch, SHAS } from './helpers/github-fixture.js';

const MITT = 'developit/mitt';
const run = promisify(execFile);

let t: TestApp;
let cookieA: string;
let cookieB: string;
let userA: string;
let userB: string;

async function userIdOf(githubId: number): Promise<string> {
  return (await t.pool.query<{ id: string }>('SELECT id FROM users WHERE github_id = $1', [githubId])).rows[0]!.id;
}
async function saveLadder(): Promise<string> {
  return (await t.pool.query<{ id: string }>('INSERT INTO ladders (repo_full_name, commit_sha) VALUES ($1, $2) RETURNING id', [MITT, SHAS.mitt])).rows[0]!.id;
}
const start = (cookie: string) => postStart(t, cookie, { url: 'https://github.com/developit/mitt' });
const learnerRows = async () => Number((await t.pool.query('SELECT count(*)::int AS n FROM ladder_learners')).rows[0].n);

beforeAll(async () => {
  const gh = () => fixtureFetch('developit__mitt');
  t = await startTestApp({ fetchImpl: ((...args: Parameters<typeof fetch>) => gh().fetch(...args)) as typeof fetch });
  cookieA = await t.signIn(1);
  cookieB = await t.signIn(2);
  userA = await userIdOf(1);
  userB = await userIdOf(2);
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  t.events.length = 0;
  await t.pool.query('DROP TRIGGER IF EXISTS fail_learner_insert ON ladder_learners');
  await t.pool.query('DELETE FROM ladder_learners');
  await t.pool.query('DELETE FROM generation_jobs');
  await t.pool.query('DELETE FROM ladders');
});

describe('T032 every learner who starts a ladder is recorded', () => {
  it('AC1: a cache-hit learner sees the ladder on My ladders and can review its L0 cards', async () => {
    // Own database: the rating writes an append-only review_log row, which blocks the shared cleanup.
    const t1 = await startTestApp({ fetchImpl: fixtureFetch('developit__mitt').fetch });
    try {
      const cookie = await t1.signIn(1);
      const userId = (await t1.pool.query<{ id: string }>('SELECT id FROM users WHERE github_id = 1')).rows[0]!.id;
      const ladderId = (await t1.pool.query<{ id: string }>('INSERT INTO ladders (repo_full_name, commit_sha) VALUES ($1, $2) RETURNING id', [MITT, SHAS.mitt])).rows[0]!.id;
      const cardId = (await t1.pool.query<{ id: string }>(`INSERT INTO cards (ladder_id, level_id, front, back) VALUES ($1, 'L0', 'q', 'a') RETURNING id`, [ladderId])).rows[0]!.id;
      const res = await postStart(t1, cookie, { url: 'https://github.com/developit/mitt' });
      expect(res.status).toBe(200);
      expect(await listMyLadders(t1.pool, userId)).toEqual([{ id: ladderId, repoFullName: MITT }]);
      expect(await (await t1.app.request('/ladders', { headers: { cookie } })).text()).toContain(`href="/ladders/${ladderId}"`);
      const queue = (await (await t1.app.request('/api/review/queue', { headers: { cookie } })).json()) as { cards: { id: string }[] };
      expect(queue.cards.map((c) => c.id)).toEqual([cardId]);
      const rated = await t1.app.request('/api/review/rating', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ cardId, rating: 3, idempotencyKey: 'ac1', elapsedMs: 1000 }),
      });
      expect(rated.status).toBe(200);
    } finally {
      await t1.close();
    }
  });

  it('AC2: two learners who start while the job is open both see the ladder once it is saved, in either order', async () => {
    for (const [first, second] of [[cookieA, cookieB], [cookieB, cookieA]] as const) {
      await t.pool.query('DELETE FROM ladder_learners');
      await t.pool.query('DELETE FROM generation_jobs');
      await t.pool.query('DELETE FROM ladders');
      const a = (await (await start(first)).json()) as { jobId: string };
      const b = (await (await start(second)).json()) as { jobId: string };
      expect(b.jobId).toBe(a.jobId);
      expect(await listMyLadders(t.pool, userA)).toEqual([]);
      const ladderId = await saveLadder();
      expect((await listMyLadders(t.pool, userA)).map((l) => l.id)).toEqual([ladderId]);
      expect((await listMyLadders(t.pool, userB)).map((l) => l.id)).toEqual([ladderId]);
    }
  });

  it('AC2: parallel starts by two learners each get a record', async () => {
    await Promise.all([start(cookieA), start(cookieB), start(cookieA)]);
    const ladderId = await saveLadder();
    expect((await listMyLadders(t.pool, userA)).map((l) => l.id)).toEqual([ladderId]);
    expect((await listMyLadders(t.pool, userB)).map((l) => l.id)).toEqual([ladderId]);
  });

  it('AC3: starting twice (job, failed job, then hit) writes one record and one My ladders row', async () => {
    await start(cookieA);
    await t.pool.query(`UPDATE generation_jobs SET status = 'failed', reason = 'x'`);
    await start(cookieA);
    await saveLadder();
    await start(cookieA);
    expect(await learnerRows()).toBe(1);
    expect(await listMyLadders(t.pool, userA)).toHaveLength(1);
  });

  it('AC4: a learner who never started the ladder does not see it and cannot rate its cards (404)', async () => {
    const ladderId = await saveLadder();
    const cardId = (await t.pool.query<{ id: string }>(`INSERT INTO cards (ladder_id, level_id, front, back) VALUES ($1, 'L0', 'q', 'a') RETURNING id`, [ladderId])).rows[0]!.id;
    await start(cookieA);
    expect(await listMyLadders(t.pool, userB)).toEqual([]);
    const rated = await t.app.request('/api/review/rating', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieB },
      body: JSON.stringify({ cardId, rating: 3, idempotencyKey: 'ac4', elapsedMs: 1000 }),
    });
    expect(rated.status).toBe(404);
  });

  it('AC6: a failed record write fails the request; no job and no ladder id is handed out', async () => {
    await t.pool.query(`CREATE OR REPLACE FUNCTION fail_learner_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'boom'; END $$`);
    await t.pool.query('CREATE TRIGGER fail_learner_insert BEFORE INSERT ON ladder_learners FOR EACH ROW EXECUTE FUNCTION fail_learner_insert()');
    const miss = await start(cookieA);
    expect(miss.status).toBe(500);
    expect(Number((await t.pool.query('SELECT count(*)::int AS n FROM generation_jobs')).rows[0].n)).toBe(0);
    expect(t.events).toHaveLength(0);
    await saveLadder();
    const hit = await start(cookieA);
    expect(hit.status).toBe(500);
    expect(await hit.text()).not.toContain('ladderId');
  });

  it('edge: deleting a learner deletes their records', async () => {
    const cookie = await t.signIn(3);
    await start(cookie);
    expect(await learnerRows()).toBe(1);
    await t.pool.query('DELETE FROM users WHERE github_id = 3');
    expect(await learnerRows()).toBe(0);
  });
});

describe('T032 migration', () => {
  it('AC5: copies every existing started_by into ladder_learners, once per learner + repo + SHA', async () => {
    const db = await createTempDb();
    try {
      await run('pnpm', ['--silent', 'db:migrate', '3'], { env: { ...process.env, DATABASE_URL: db.url } });
      const c = new pg.Client({ connectionString: db.url });
      await c.connect();
      try {
        const u = (await c.query<{ id: string }>(`INSERT INTO users (github_id, github_login) VALUES (9, 'u9') RETURNING id`)).rows[0]!.id;
        await c.query(`INSERT INTO generation_jobs (repo_full_name, commit_sha, status, started_by) VALUES ($1, $2, 'failed', $3), ($1, $2, 'fetched', $3), ('lukeed/dset', $4, 'queued', NULL)`, [MITT, SHAS.mitt, u, '1'.repeat(40)]);
        await runMigrate(db.url, 'up');
        const rows = (await c.query('SELECT user_id, repo_full_name, commit_sha FROM ladder_learners')).rows;
        expect(rows).toEqual([{ user_id: u, repo_full_name: MITT, commit_sha: SHAS.mitt }]);
      } finally {
        await c.end();
      }
    } finally {
      await db.drop();
    }
  });
});
