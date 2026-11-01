import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initialState, scheduleNext, stateToJson, type CardState, type ReviewRating } from '../src/review/scheduler.js';
import { MAX_CLIENT_AGE_MS, MAX_CLIENT_AHEAD_MS, resolveReviewedAt } from '../src/review/sync.js';
import { startTestApp, type TestApp } from './helpers/app.js';
import { days, minutes, postJson, scenario } from './helpers/review-scenario.js';

const T0 = new Date('2026-11-01T09:00:00Z');

describe('T015 reviewedAt validation (unit)', () => {
  const last = new Date('2026-10-30T09:00:00Z');
  it('no client time: server time, not a rejection', () => {
    expect(resolveReviewedAt(undefined, last, T0)).toEqual({ reviewedAt: T0, clientTimeRejected: false });
  });
  it('accepts a time after the last review and not later than server time + 5 minutes', () => {
    const c = new Date('2026-11-01T06:00:00Z');
    expect(resolveReviewedAt(c, last, T0)).toEqual({ reviewedAt: c, clientTimeRejected: false });
    const edge = new Date(T0.getTime() + MAX_CLIENT_AHEAD_MS);
    expect(resolveReviewedAt(edge, last, T0).clientTimeRejected).toBe(false);
    expect(resolveReviewedAt(new Date(edge.getTime() + 1), last, T0)).toEqual({ reviewedAt: T0, clientTimeRejected: true });
  });
  it('rejects a time equal to or before the last review', () => {
    expect(resolveReviewedAt(last, last, T0).clientTimeRejected).toBe(true);
    expect(resolveReviewedAt(new Date(last.getTime() - 1), last, T0).clientTimeRejected).toBe(true);
  });
  it('a card never rated has no last review to compare with; only the 30 day floor applies', () => {
    const c = new Date(T0.getTime() - 3 * 3_600_000);
    expect(resolveReviewedAt(c, null, T0).reviewedAt).toEqual(c);
    expect(resolveReviewedAt(new Date(T0.getTime() - MAX_CLIENT_AGE_MS - 1), null, T0)).toEqual({ reviewedAt: T0, clientTimeRejected: true });
  });
});

describe('T015 browser scheduler twin (public/fsrs-client.js)', () => {
  function load() {
    const ctx = vm.createContext({});
    vm.runInContext(readFileSync('node_modules/ts-fsrs/dist/index.umd.js', 'utf8'), ctx);
    vm.runInContext(readFileSync('public/fsrs-client.js', 'utf8'), ctx);
    return (state: unknown, rating: number, at: Date) =>
      JSON.parse(JSON.stringify(vm.runInContext(`ILScheduler.scheduleNext(${JSON.stringify(state)}, ${rating}, new Date(${JSON.stringify(at.toISOString())}))`, ctx)));
  }

  it('gives the same state as the server scheduleNext over a rating sequence, from a new card', () => {
    const client = load();
    const ratings: ReviewRating[] = [3, 3, 1, 2, 3, 4, 1, 3, 4, 2];
    let server: CardState = initialState(T0);
    let local: unknown = null;
    ratings.forEach((r, i) => {
      const at = days(T0, i * 2);
      server = scheduleNext(server, r, at);
      local = client(local, r, at);
      expect(local).toEqual(JSON.parse(JSON.stringify(stateToJson(server))));
    });
  });
});

describe('T015 offline sync (integration)', () => {
  let t: TestApp;
  let clock = T0;
  let passed: string[] = [];

  beforeAll(async () => {
    t = await startTestApp({ now: () => clock, readPassed: async () => passed });
  });
  afterAll(async () => {
    await t.close();
  });

  const rate = (cookie: string, body: Record<string, unknown>) => postJson(t, '/api/review/rating', cookie, { elapsedMs: 900, ...body });
  const logRows = async (userId: string, cardId: string) => (await t.pool.query('SELECT * FROM review_log WHERE user_id = $1 AND card_id = $2 ORDER BY id', [userId, cardId])).rows;

  it('AC3: a queued rating with a valid reviewedAt is scheduled at that time; local and server states are equal', async () => {
    clock = T0;
    const s = await scenario(t);
    const ids = [await s.card('L0'), await s.card('L0'), await s.card('L0')];
    const offline = minutes(T0, -90);
    const local: Record<string, unknown> = {};
    // The device queue, sent oldest first.
    for (const [i, cardId] of ids.entries()) {
      const at = minutes(offline, i * 2);
      local[cardId] = stateToJson(scheduleNext(initialState(at), 3, at));
      const res = await rate(s.cookie, { cardId, rating: 3, idempotencyKey: `q-${s.userId}-${i}`, reviewedAt: at.toISOString() });
      expect(res.status).toBe(200);
      const data = (await res.json()) as { card: unknown; clientTimeRejected?: boolean };
      expect(data.clientTimeRejected).toBeUndefined();
      expect(data.card).toEqual(local[cardId]);
      const rows = await logRows(s.userId, cardId);
      expect(rows).toHaveLength(1);
      expect(rows[0].reviewed_at).toEqual(at);
      expect(rows[0].client_time_rejected).toBe(false);
    }
  });

  it('AC3: reviewedAt 2 hours ahead of the server is rejected: server time used, log row flagged', async () => {
    clock = T0;
    const s = await scenario(t);
    const cardId = await s.card('L0');
    const res = await rate(s.cookie, { cardId, rating: 3, idempotencyKey: `ahead-${s.userId}`, reviewedAt: minutes(T0, 120).toISOString() });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { clientTimeRejected?: boolean }).clientTimeRejected).toBe(true);
    const row = (await logRows(s.userId, cardId))[0];
    expect(row.reviewed_at).toEqual(T0);
    expect(row.client_time_rejected).toBe(true);
    expect((await t.pool.query('SELECT last_review FROM card_states WHERE user_id = $1', [s.userId])).rows[0].last_review).toEqual(T0);
  });

  it('AC3: reviewedAt not after the card last review is rejected', async () => {
    clock = T0;
    const s = await scenario(t);
    const cardId = await s.card('L0');
    await s.seedDue(cardId, minutes(T0, -10)); // last review = due - 5 days
    const lastReview = days(minutes(T0, -10), -5);
    const before = await rate(s.cookie, { cardId, rating: 3, idempotencyKey: `before-${s.userId}`, reviewedAt: lastReview.toISOString() });
    expect(((await before.json()) as { clientTimeRejected?: boolean }).clientTimeRejected).toBe(true);
    const row = (await logRows(s.userId, cardId))[0];
    expect(row.reviewed_at).toEqual(T0);
    expect(row.client_time_rejected).toBe(true);
  });

  it('AC3: a rating sent twice makes one log row; the replay returns the stored state', async () => {
    clock = T0;
    const s = await scenario(t);
    const cardId = await s.card('L0');
    const body = { cardId, rating: 4, idempotencyKey: `twice-${s.userId}`, reviewedAt: minutes(T0, -30).toISOString() };
    const a = await rate(s.cookie, body);
    const b = await rate(s.cookie, body);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(((await b.json()) as { replayed: boolean }).replayed).toBe(true);
    expect(await logRows(s.userId, cardId)).toHaveLength(1);
  });

  it('a reviewedAt that is not a date is a 400 and writes nothing', async () => {
    const s = await scenario(t);
    const cardId = await s.card('L0');
    for (const reviewedAt of ['yesterday', 12345, null]) {
      expect((await rate(s.cookie, { cardId, rating: 3, idempotencyKey: `bad-${s.userId}`, reviewedAt })).status).toBe(400);
    }
    expect(await logRows(s.userId, cardId)).toHaveLength(0);
  });

  it('offline pack: states for cards due in the next 7 days, new cards without state, nothing from locked levels', async () => {
    clock = T0;
    passed = [];
    const s = await scenario(t);
    const dueNow = await s.card('L0', 'now');
    const inThreeDays = await s.card('L0', 'soon');
    const inTenDays = await s.card('L0', 'far');
    const fresh = await s.card('L0', 'fresh');
    const locked = await s.card('L1', 'locked');
    await s.seedDue(dueNow, minutes(T0, -5));
    await s.seedDue(inThreeDays, days(T0, 3));
    await s.seedDue(inTenDays, days(T0, 10));
    await s.seedDue(locked, minutes(T0, -5));
    const res = await t.app.request('/api/review/offline-pack', { headers: { cookie: s.cookie } });
    expect(res.status).toBe(200);
    const pack = (await res.json()) as { learnerId: string; cards: Array<{ id: string; fsrs: { due: string; reps: number } | null }>; fetchedAt: string };
    expect(pack.learnerId).toBe(s.userId);
    expect(pack.cards.map((c) => c.id)).toEqual([dueNow, inThreeDays, fresh]);
    expect(pack.cards[0]!.fsrs).toMatchObject({ reps: 3, due: minutes(T0, -5).toISOString() });
    expect(pack.cards[2]!.fsrs).toBeNull();
    expect((await t.app.request('/api/review/offline-pack')).status).toBe(401);
  });
});
