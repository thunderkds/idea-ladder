import { randomBytes } from 'node:crypto';
import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card } from 'ts-fsrs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initialState, replayLog, scheduleNext, stateToJson, type CardState, type ReviewRating } from '../src/review/scheduler.js';
import { NEW_CARDS_PER_DAY } from '../src/review/store.js';
import { startTestApp, type TestApp } from './helpers/app.js';

const lib = fsrs(generatorParameters({ enable_fuzz: false }));
const T0 = new Date('2026-11-01T09:00:00Z');
const GRADES: ReviewRating[] = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy];

function libState(c: Card): CardState {
  return {
    due: c.due, stability: c.stability, difficulty: c.difficulty, elapsedDays: c.elapsed_days, scheduledDays: c.scheduled_days,
    learningSteps: c.learning_steps, reps: c.reps, lapses: c.lapses, state: c.state, lastReview: c.last_review ?? null,
  };
}
const minutes = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);
const days = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/** One card in each FSRS state, built with the library directly. */
function cardsInEveryState(): Card[] {
  const fresh = createEmptyCard(T0);
  const learning = lib.next(fresh, T0, Rating.Again).card;
  let review = lib.next(fresh, T0, Rating.Easy).card;
  if (review.state !== State.Review) review = lib.next(learning, learning.due, Rating.Easy).card;
  const relearning = lib.next(review, review.due, Rating.Again).card;
  return [fresh, learning, review, relearning];
}

describe('T011 scheduleNext (pure)', () => {
  it('equals ts-fsrs for all 4 ratings in all 4 card states', () => {
    const cards = cardsInEveryState();
    expect(cards.map((c) => c.state)).toEqual([State.New, State.Learning, State.Review, State.Relearning]);
    for (const card of cards) {
      for (const rating of GRADES) {
        const at = card.state === State.New ? T0 : days(card.due, 1);
        expect(scheduleNext(libState(card), rating, at)).toEqual(libState(lib.next(card, at, rating).card));
      }
    }
  });

  it('new card, Good at 2026-11-01T09:00:00Z: state equals the library output', () => {
    const expected = lib.next(createEmptyCard(T0), T0, Rating.Good).card;
    expect(scheduleNext(initialState(T0), Rating.Good, T0)).toEqual(libState(expected));
  });

  it('replaying a log from the initial state reproduces the final state', () => {
    const entries = [Rating.Good, Rating.Good, Rating.Again, Rating.Hard, Rating.Good, Rating.Easy, Rating.Again, Rating.Good, Rating.Good, Rating.Easy].map(
      (rating, i) => ({ rating: rating as ReviewRating, reviewedAt: days(T0, i * 3) }),
    );
    let state = initialState(T0);
    for (const e of entries) state = scheduleNext(state, e.rating, e.reviewedAt);
    expect(replayLog(entries)).toEqual(state);
  });

  it('Rating.Manual (0) is not an accepted grade', async () => {
    const { isReviewRating } = await import('../src/review/scheduler.js');
    expect(isReviewRating(0)).toBe(false);
    expect(isReviewRating(5)).toBe(false);
    expect(isReviewRating('3')).toBe(false);
    expect([1, 2, 3, 4].every(isReviewRating)).toBe(true);
  });
});

describe('T011 review queue and rating (integration)', () => {
  let t: TestApp;
  let clock = T0;
  let passed: string[] = [];
  let seq = 100;

  beforeAll(async () => {
    t = await startTestApp({ now: () => clock, readPassed: async () => passed });
  });
  afterAll(async () => {
    await t.close();
  });

  interface Scenario {
    cookie: string;
    userId: string;
    ladderId: string;
    card: (level: string, front?: string) => Promise<string>;
  }

  /** A fresh learner who started a fresh ladder. Rows are never deleted: review_log is append-only. */
  async function scenario(started = true): Promise<Scenario> {
    const githubId = seq++;
    const cookie = await t.signIn(githubId);
    const userId = (await t.pool.query<{ id: string }>('SELECT id FROM users WHERE github_id = $1', [githubId])).rows[0]!.id;
    const repo = `owner/repo${githubId}`;
    const sha = randomBytes(20).toString('hex');
    const ladderId = (await t.pool.query<{ id: string }>('INSERT INTO ladders (repo_full_name, commit_sha) VALUES ($1, $2) RETURNING id', [repo, sha])).rows[0]!.id;
    if (started) {
      await t.pool.query(`INSERT INTO generation_jobs (repo_full_name, commit_sha, status, started_by) VALUES ($1, $2, 'fetched', $3)`, [repo, sha, userId]);
      await t.pool.query(`INSERT INTO ladder_learners (user_id, repo_full_name, commit_sha) VALUES ($1, $2, $3)`, [userId, repo, sha]);
    }
    const card = async (level: string, front = `question ${seq++}`) =>
      (await t.pool.query<{ id: string }>(`INSERT INTO cards (ladder_id, level_id, front, back) VALUES ($1, $2, $3, 'answer') RETURNING id`, [ladderId, level, front])).rows[0]!.id;
    return { cookie, userId, ladderId, card };
  }

  async function seedDue(userId: string, cardId: string, due: Date) {
    const s = stateToJson({ ...initialState(due), state: 2, reps: 3, stability: 5, difficulty: 5, lastReview: days(due, -5) });
    await t.pool.query(
      `INSERT INTO card_states (user_id, card_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review)
       VALUES ($1, $2, $3, $4, $5, 0, 5, 0, 3, 0, 2, $6)`,
      [userId, cardId, due, s.stability, s.difficulty, days(due, -5)],
    );
  }

  const queue = async (cookie?: string) => t.app.request('/api/review/queue', { headers: cookie ? { cookie } : {} });
  const rate = (cookie: string | undefined, body: unknown, headers: Record<string, string> = {}) =>
    t.app.request('/api/review/rating', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  const body = (cardId: string, rating: number, key: string, elapsedMs = 1500) => ({ cardId, rating, idempotencyKey: key, elapsedMs });
  const logRows = async (userId: string, cardId: string) =>
    (await t.pool.query('SELECT * FROM review_log WHERE user_id = $1 AND card_id = $2 ORDER BY id', [userId, cardId])).rows;

  it('AC1: queue = due cards of unlocked levels, oldest due first; locked-level cards never appear', async () => {
    clock = T0;
    passed = [];
    const s = await scenario();
    const a = await s.card('L0', 'a');
    const b = await s.card('L0', 'b');
    const c = await s.card('L0', 'c');
    const notYet = await s.card('L0', 'later');
    const l1a = await s.card('L1');
    const l1b = await s.card('L1');
    await seedDue(s.userId, b, minutes(T0, -30));
    await seedDue(s.userId, a, minutes(T0, -60));
    await seedDue(s.userId, c, T0); // due exactly now is in the queue
    await seedDue(s.userId, notYet, minutes(T0, 90));
    await seedDue(s.userId, l1a, minutes(T0, -120));
    await seedDue(s.userId, l1b, minutes(T0, -10));

    const res = await queue(s.cookie);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { cards: { id: string }[]; nextDue: string | null; hasCards: boolean };
    expect(data.cards.map((x) => x.id)).toEqual([a, b, c]);
    expect(data.nextDue).toBe(minutes(T0, 90).toISOString());
    expect(data.hasCards).toBe(true);

    // The same level becomes reviewable once the pass lookup says L0 is passed; state was kept.
    passed = ['L0'];
    const open = (await (await queue(s.cookie)).json()) as { cards: { id: string }[] };
    expect(open.cards.map((x) => x.id)).toEqual([l1a, a, b, l1b, c]);
    passed = [];
  });

  it('new cards: at most NEW_CARDS_PER_DAY a day, counting new cards already rated today', async () => {
    clock = T0;
    const s = await scenario();
    const ids: string[] = [];
    for (let i = 0; i < NEW_CARDS_PER_DAY + 2; i++) ids.push(await s.card('L0'));
    const first = (await (await queue(s.cookie)).json()) as { cards: { id: string }[] };
    expect(first.cards).toHaveLength(NEW_CARDS_PER_DAY);
    for (const [i, cardId] of first.cards.slice(0, 3).entries()) expect((await rate(s.cookie, body(cardId.id, 3, `new-${s.userId}-${i}`))).status).toBe(200);
    const after = (await (await queue(s.cookie)).json()) as { cards: { id: string }[] };
    expect(after.cards).toHaveLength(NEW_CARDS_PER_DAY - 3);
    expect(after.cards.some((x) => first.cards.slice(0, 3).some((y) => y.id === x.id))).toBe(false);
  });

  it('empty states: no cards, and cards that are not due yet', async () => {
    clock = T0;
    const none = await scenario();
    expect(await (await queue(none.cookie)).json()).toEqual({ cards: [], nextDue: null, hasCards: false });
    const unstarted = await scenario(false);
    await unstarted.card('L0');
    expect(await (await queue(unstarted.cookie)).json()).toEqual({ cards: [], nextDue: null, hasCards: false });
    const later = await scenario();
    const c = await later.card('L0');
    await seedDue(later.userId, c, days(T0, 2));
    expect(await (await queue(later.cookie)).json()).toEqual({ cards: [], nextDue: days(T0, 2).toISOString(), hasCards: true });
  });

  it('AC2+3: a rating stores the library state and one log row; 10 ratings replay to the stored state', async () => {
    const s = await scenario();
    const cardId = await s.card('L0');
    const ratings = [3, 3, 1, 2, 3, 4, 1, 3, 3, 4];
    clock = T0;
    for (const [i, r] of ratings.entries()) {
      clock = days(T0, i * 3);
      const res = await rate(s.cookie, body(cardId, r, `replay-${s.userId}-${i}`, 800 + i));
      expect(res.status).toBe(200);
    }
    const rows = await logRows(s.userId, cardId);
    expect(rows).toHaveLength(10);
    expect(rows[0]).toMatchObject({ rating: 3, elapsed_ms: 800, user_id: s.userId, card_id: cardId });
    expect(rows[0].reviewed_at).toEqual(T0);

    const stored = (await t.pool.query('SELECT * FROM card_states WHERE user_id = $1 AND card_id = $2', [s.userId, cardId])).rows[0];
    const replayed = replayLog(rows.map((r) => ({ rating: r.rating as ReviewRating, reviewedAt: r.reviewed_at as Date })));
    expect({
      due: stored.due, stability: stored.stability, difficulty: stored.difficulty, elapsedDays: stored.elapsed_days, scheduledDays: stored.scheduled_days,
      learningSteps: stored.learning_steps, reps: stored.reps, lapses: stored.lapses, state: stored.state, lastReview: stored.last_review,
    }).toEqual(replayed);
    expect(stored.reps).toBe(10);
    // Each log row starts from the state the previous row ended in.
    for (let i = 1; i < rows.length; i++) expect(rows[i].state_before).toEqual(rows[i - 1].state_after);
    // The first rating equals a direct library call.
    expect(rows[0].state_after).toEqual(stateToJson(libState(lib.next(createEmptyCard(T0), T0, Rating.Good).card)));
  });

  it('AC6: the same idempotency key does not write a second log row or advance the card twice', async () => {
    clock = T0;
    const s = await scenario();
    const cardId = await s.card('L0');
    const first = await rate(s.cookie, body(cardId, 3, 'same-key'));
    clock = minutes(T0, 5);
    const second = await rate(s.cookie, body(cardId, 3, 'same-key'));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const a = (await first.json()) as { replayed: boolean; card: unknown };
    const b = (await second.json()) as { replayed: boolean; card: unknown };
    expect(a.replayed).toBe(false);
    expect(b.replayed).toBe(true);
    expect(b.card).toEqual(a.card);
    expect(await logRows(s.userId, cardId)).toHaveLength(1);
    expect((await t.pool.query('SELECT reps FROM card_states WHERE user_id = $1', [s.userId])).rows[0].reps).toBe(1);
    // One key for a second card is refused and writes nothing.
    const other = await s.card('L0');
    expect((await rate(s.cookie, body(other, 3, 'same-key'))).status).toBe(409);
    expect(await logRows(s.userId, other)).toHaveLength(0);
  });

  it('two tabs rating the same card at once: the second rating applies to the updated state', async () => {
    clock = T0;
    const s = await scenario();
    const cardId = await s.card('L0');
    const [r1, r2] = await Promise.all([rate(s.cookie, body(cardId, 3, 'tab-1')), rate(s.cookie, body(cardId, 3, 'tab-2'))]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    const rows = await logRows(s.userId, cardId);
    expect(rows).toHaveLength(2);
    expect(rows[1].state_before).toEqual(rows[0].state_after);
    expect((await t.pool.query('SELECT reps FROM card_states WHERE user_id = $1', [s.userId])).rows[0].reps).toBe(2);
  });

  it('server time is the only reviewed_at; the body cannot set it', async () => {
    clock = new Date('2026-11-02T01:02:03Z');
    const s = await scenario();
    const cardId = await s.card('L0');
    const res = await rate(s.cookie, { ...body(cardId, 3, 'time-key'), reviewedAt: '2001-01-01T00:00:00Z' });
    expect(res.status).toBe(200);
    expect((await logRows(s.userId, cardId))[0].reviewed_at).toEqual(clock);
  });

  it('AC7: 401 without a session; 404 for a ladder not started, another learner, a locked level, an unknown card; no state change', async () => {
    clock = T0;
    passed = [];
    const owner = await scenario();
    const ownerCard = await owner.card('L0');
    const lockedCard = await owner.card('L1');
    const stranger = await scenario();
    const unauth = await rate(undefined, body(ownerCard, 3, 'k-unauth'));
    expect(unauth.status).toBe(401);
    expect((await queue()).status).toBe(401);

    expect((await rate(stranger.cookie, body(ownerCard, 3, 'k-stranger'))).status).toBe(404);
    expect((await rate(owner.cookie, body(lockedCard, 3, 'k-locked'))).status).toBe(404);
    expect((await rate(owner.cookie, body('00000000-0000-4000-8000-000000000000', 3, 'k-unknown'))).status).toBe(404);
    expect((await rate(owner.cookie, body('not-a-uuid', 3, 'k-bad'))).status).toBe(404);

    const count = async () => Number((await t.pool.query('SELECT (SELECT count(*) FROM review_log WHERE card_id IN ($1, $2)) + (SELECT count(*) FROM card_states WHERE card_id IN ($1, $2)) AS n', [ownerCard, lockedCard])).rows[0].n);
    expect(await count()).toBe(0);
  });

  it('bad input is refused: Rating.Manual, out-of-range rating, bad elapsed, bad key, non-JSON', async () => {
    const s = await scenario();
    const cardId = await s.card('L0');
    for (const rating of [0, 5, -1, 2.5, '3', null]) expect((await rate(s.cookie, { ...body(cardId, 3, 'k'), rating })).status).toBe(400);
    for (const elapsedMs of [-1, 1.5, '5', 86_400_001]) expect((await rate(s.cookie, { ...body(cardId, 3, 'k'), elapsedMs })).status).toBe(400);
    expect((await rate(s.cookie, { ...body(cardId, 3, ''), idempotencyKey: '' })).status).toBe(400);
    expect((await rate(s.cookie, { ...body(cardId, 3, 'k'), idempotencyKey: 'x'.repeat(129) })).status).toBe(400);
    expect((await rate(s.cookie, '{not json')).status).toBe(400);
    expect((await rate(s.cookie, 'x', { 'content-type': 'text/plain' })).status).toBe(415);
    expect(await logRows(s.userId, cardId)).toHaveLength(0);
  });

  it('AC3: the review log rejects UPDATE and DELETE', async () => {
    const s = await scenario();
    const cardId = await s.card('L0');
    expect((await rate(s.cookie, body(cardId, 3, 'append-only'))).status).toBe(200);
    await expect(t.pool.query('UPDATE review_log SET rating = 1 WHERE user_id = $1', [s.userId])).rejects.toThrow(/append-only/);
    await expect(t.pool.query('DELETE FROM review_log WHERE user_id = $1', [s.userId])).rejects.toThrow(/append-only/);
    expect(await logRows(s.userId, cardId)).toHaveLength(1);
  });

  it('pages: /review needs a session; "Start review" links to it from the ladder view and My ladders', async () => {
    const s = await scenario();
    const anon = await t.app.request('/review', { redirect: 'manual' });
    expect(anon.status).toBe(302);
    expect(anon.headers.get('location')).toBe('/');
    const page = await t.app.request('/review', { headers: { cookie: s.cookie } });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('/assets/review.js');
    const ladder = await (await t.app.request(`/ladders/${s.ladderId}`, { headers: { cookie: s.cookie } })).text();
    expect(ladder).toMatch(/<a class="button" href="\/review">\s*Start review/);
    const list = await (await t.app.request('/ladders', { headers: { cookie: s.cookie } })).text();
    expect(list).toMatch(/href="\/review">\s*Start review/);
  });
});
