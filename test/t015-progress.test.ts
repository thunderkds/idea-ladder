import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportProgress, MAX_IMPORT_BYTES, type ProgressExport } from '../src/progress/transfer.js';
import { startTestApp, type TestApp } from './helpers/app.js';
import { days, minutes, postJson, scenario, type Scenario } from './helpers/review-scenario.js';

const T0 = new Date('2026-11-01T09:00:00Z');

describe('T015 export and import of progress (integration)', () => {
  let t: TestApp;
  let clock = T0;

  beforeAll(async () => {
    t = await startTestApp({ now: () => clock, readPassed: async () => [] });
  });
  afterAll(async () => {
    await t.close();
  });

  const rate = (s: Scenario, cardId: string, rating: number, key: string) =>
    postJson(t, '/api/review/rating', s.cookie, { cardId, rating, idempotencyKey: key, elapsedMs: 700 });
  const exportOf = async (s: Scenario) => (await (await t.app.request('/api/progress/export', { headers: { cookie: s.cookie } })).json()) as ProgressExport;
  const importFile = (s: Scenario | undefined, file: unknown, headers: Record<string, string> = {}) => postJson(t, '/api/progress/import', s?.cookie, file, headers);
  /** Rows of the review tables for one learner, in a form two snapshots can be compared in. */
  const snapshot = async (s: Scenario) => ({
    states: (await t.pool.query('SELECT * FROM card_states WHERE user_id = $1 ORDER BY card_id', [s.userId])).rows,
    log: (await t.pool.query('SELECT * FROM review_log WHERE user_id = $1 ORDER BY id', [s.userId])).rows,
  });
  /** Row counts of every table that is not review data: an import must never change them. */
  const otherTables = async () => {
    const names = (
      await t.pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name NOT IN ('card_states', 'review_log', 'pgmigrations') ORDER BY table_name`,
      )
    ).rows.map((r) => r.table_name);
    const out: Record<string, number> = {};
    for (const n of names) out[n] = Number((await t.pool.query(`SELECT count(*) AS n FROM ${n}`)).rows[0].n);
    return out;
  };

  async function learnerWithReviews() {
    clock = T0;
    const s = await scenario(t);
    const a = await s.card('L0');
    const b = await s.card('L0');
    const locked = await s.card('L3');
    for (const [i, id] of [a, b].entries()) {
      clock = minutes(T0, i);
      expect((await rate(s, id, 3, `exp-${s.userId}-${i}`)).status).toBe(200);
    }
    return { s, a, b, locked };
  }

  it('AC5: the export has the documented shape; levelStatus and evidenceHashes are empty until T012 and T030', async () => {
    const { s, a, b } = await learnerWithReviews();
    const res = await t.app.request('/api/progress/export', { headers: { cookie: s.cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="idea-ladder-progress-.*\.json"$/);
    const file = (await res.json()) as ProgressExport;
    expect(Object.keys(file).sort()).toEqual(['cardStates', 'evidenceHashes', 'exportedAt', 'format', 'learner', 'levelStatus', 'reviewLog', 'version']);
    expect(file).toMatchObject({ format: 'idea-ladder-progress', version: 1, learner: s.userId, levelStatus: [], evidenceHashes: [] });
    expect(file.cardStates.map((c) => c.cardId).sort()).toEqual([a, b].sort());
    expect(file.reviewLog).toHaveLength(2);
    expect(file.reviewLog[0]).toMatchObject({ cardId: a, rating: 3, idempotencyKey: `exp-${s.userId}-0`, elapsedMs: 700 });
    expect((await t.app.request('/api/progress/export')).status).toBe(401);
  });

  it('AC6: export then import of the same file changes nothing and adds no duplicate rows', async () => {
    const { s } = await learnerWithReviews();
    const file = await exportOf(s);
    const before = await snapshot(s);
    const tables = await otherTables();
    const res = await importFile(s, file);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cardStatesUpdated: 0, cardStatesSkipped: 2, logRowsAdded: 0, logRowsSkipped: 2 });
    expect(await snapshot(s)).toEqual(before);
    expect(await otherTables()).toEqual(tables);
  });

  it('AC6: a card state is replaced only when the imported last review is newer; new log rows are added once', async () => {
    const { s, a, b } = await learnerWithReviews();
    const file = await exportOf(s);
    const stateOf = async (id: string) => (await t.pool.query('SELECT * FROM card_states WHERE user_id = $1 AND card_id = $2', [s.userId, id])).rows[0];
    const bBefore = await stateOf(b);

    const newer = structuredClone(file);
    const na = newer.cardStates.find((c) => c.cardId === a)!;
    na.lastReview = days(T0, 3).toISOString();
    na.due = days(T0, 9).toISOString();
    na.reps = 7;
    const older = newer.cardStates.find((c) => c.cardId === b)!;
    older.lastReview = days(T0, -3).toISOString(); // older than the server's: must not replace
    older.reps = 99;
    newer.reviewLog.push({ ...file.reviewLog[0]!, idempotencyKey: `from-device-${s.userId}`, reviewedAt: days(T0, 3).toISOString() });

    clock = days(T0, 4); // the imported dates are in the past of this clock
    const first = await importFile(s, newer);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ cardStatesUpdated: 1, logRowsAdded: 1 });
    expect(await stateOf(a)).toMatchObject({ reps: 7, last_review: days(T0, 3) });
    expect(await stateOf(b)).toEqual(bBefore);
    const second = await importFile(s, newer);
    expect(await second.json()).toMatchObject({ cardStatesUpdated: 0, logRowsAdded: 0 });
    expect((await t.pool.query('SELECT count(*) AS n FROM review_log WHERE user_id = $1', [s.userId])).rows[0].n).toBe('3');
  });

  it('AC6: cards of a locked level or an unknown card are skipped, not written', async () => {
    const { s, a, locked } = await learnerWithReviews();
    const file = await exportOf(s);
    const state = file.cardStates[0]!;
    file.cardStates.push({ ...state, cardId: locked }, { ...state, cardId: '00000000-0000-4000-8000-000000000000' });
    file.reviewLog.push({ ...file.reviewLog[0]!, cardId: locked, idempotencyKey: `locked-${s.userId}` });
    const res = await importFile(s, file);
    expect(res.status).toBe(200);
    expect((await t.pool.query('SELECT count(*) AS n FROM card_states WHERE user_id = $1 AND card_id = $2', [s.userId, locked])).rows[0].n).toBe('0');
    expect((await t.pool.query('SELECT count(*) AS n FROM review_log WHERE user_id = $1 AND idempotency_key = $2', [s.userId, `locked-${s.userId}`])).rows[0].n).toBe('0');
    expect(a).toBeTruthy();
  });

  it('AC6 negative: a date in the future is rejected, and the card can still be rated', async () => {
    const { s, a } = await learnerWithReviews();
    const before = await snapshot(s);
    const stateFile = await exportOf(s);
    stateFile.cardStates[0]!.lastReview = '2099-01-01T00:00:00.000Z';
    expect((await importFile(s, stateFile)).status).toBe(422);
    const logFile = await exportOf(s);
    logFile.reviewLog[0]!.reviewedAt = '2099-01-01T00:00:00.000Z';
    expect((await importFile(s, logFile)).status).toBe(422);
    expect(await snapshot(s)).toEqual(before);
    clock = days(T0, 3);
    expect((await rate(s, a, 3, `after-future-${s.userId}`)).status).toBe(200);
  });

  it('AC6 negative: a file edited to add an evidence hash and unlock L3 changes no evidence and no lock', async () => {
    const { s, locked } = await learnerWithReviews();
    const file = await exportOf(s);
    file.levelStatus = [{ ladderId: s.ladderId, levelId: 'L3', status: 'passed' }];
    file.evidenceHashes = ['a'.repeat(64)];
    const tables = await otherTables();
    const before = await snapshot(s);
    const res = await importFile(s, file);
    expect(res.status).toBe(200);
    expect(await otherTables()).toEqual(tables);
    expect(await snapshot(s)).toEqual(before);
    // The L3 level is still locked: its card is not in the review queue and cannot be rated.
    const queue = (await (await t.app.request('/api/review/queue', { headers: { cookie: s.cookie } })).json()) as { cards: Array<{ id: string }> };
    expect(queue.cards.map((c) => c.id)).not.toContain(locked);
    expect((await rate(s, locked, 3, `locked-rate-${s.userId}`)).status).toBe(404);
  });

  it('AC6 negative: the file of another learner, version 2, a wrong format and malformed files are rejected and write nothing', async () => {
    const { s } = await learnerWithReviews();
    const other = await learnerWithReviews();
    const mine = await exportOf(s);
    const theirs = await exportOf(other.s);
    const before = await snapshot(s);
    const otherBefore = await snapshot(other.s);
    const tables = await otherTables();

    const wrongLearner = await importFile(s, theirs);
    expect(wrongLearner.status).toBe(403);
    expect(await wrongLearner.json()).toMatchObject({ error: 'wrong-learner' });
    const v2 = await importFile(s, { ...mine, version: 2 });
    expect([v2.status, ((await v2.json()) as { error: string }).error]).toEqual([422, 'unsupported-version']);
    const format = await importFile(s, { ...mine, format: 'something-else' });
    expect(((await format.json()) as { error: string }).error).toBe('malformed-file');
    const badRow = structuredClone(mine);
    badRow.reviewLog.push({ ...badRow.reviewLog[0]!, rating: 9, idempotencyKey: 'bad-row' });
    const withBadRow = await importFile(s, badRow);
    expect([withBadRow.status, ((await withBadRow.json()) as { error: string }).error]).toEqual([422, 'malformed-file']);
    const missing = await importFile(s, { format: 'idea-ladder-progress', version: 1 });
    expect(missing.status).toBe(422);
    for (const body of ['not json {', '[]', 'null', '"text"']) expect((await importFile(s, body)).status).toBe(422);

    expect(await snapshot(s)).toEqual(before);
    expect(await snapshot(other.s)).toEqual(otherBefore);
    expect(await otherTables()).toEqual(tables);
  });

  it('AC6 negative: a file over 5 MB is rejected before it is parsed; non-JSON content type and no session are refused', async () => {
    const { s } = await learnerWithReviews();
    const big = JSON.stringify({ format: 'idea-ladder-progress', pad: 'x'.repeat(MAX_IMPORT_BYTES + 1) });
    const res = await importFile(s, big);
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: 'too-large' });
    const declared = await t.app.request('/api/progress/import', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': String(MAX_IMPORT_BYTES + 1), cookie: s.cookie }, body: '{}' });
    expect(declared.status).toBe(413);
    expect((await importFile(s, {}, { 'content-type': 'text/plain' })).status).toBe(415);
    expect((await importFile(undefined, await exportOf(s))).status).toBe(401);
  });

  it('exportProgress reads only the signed-in learner', async () => {
    const { s } = await learnerWithReviews();
    const other = await learnerWithReviews();
    const file = await exportProgress(t.pool, s.userId, T0);
    expect(file.cardStates.every((c) => ![other.a, other.b].includes(c.cardId))).toBe(true);
  });
});
