import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createEmptyCard, fsrs, generatorParameters, Rating } from "ts-fsrs";
import { noPasses, type PassedLevels } from "../src/server/ladder-view.ts";
import { checkRateRequest, NEW_CARDS_PER_QUEUE, QUEUE_LIMIT, rateCard, reviewQueue } from "../src/server/review.ts";
import { type Card, newCard, scheduleNext } from "../src/server/scheduler.ts";
import type { RateRequest, Rating as ReviewRating } from "../src/shared/review.ts";
import { V0_REPOS } from "./support/github-fixtures.ts";
import { BASE, startHarness } from "./support/start-harness.ts";

const SHA: string = V0_REPOS["developit/mitt"];
const T = new Date("2026-11-01T09:00:00Z");
const at = (ms: number) => new Date(T.getTime() + ms);
const MIN = 60_000;
const DAY = 86_400_000;
const lib = fsrs(generatorParameters({ enable_fuzz: false }));
const GRADE = { again: Rating.Again, hard: Rating.Hard, good: Rating.Good, easy: Rating.Easy } as const;

let h: Awaited<ReturnType<typeof startHarness>>;
const sql = () => h.db.sql;

beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.db.drop();
});
beforeEach(async () => {
  await h.reset();
});

/** A signed-in learner: their cookie and user id. */
async function learner(): Promise<{ cookie: string; id: string }> {
  const cookie = await h.learner();
  const [{ id }] = await sql()`SELECT max(id)::text AS id FROM users`;
  return { cookie, id };
}
let repoN = 0;
/** A ladder; `startedBy` gets a generation job on it, which is what "a ladder the learner started" means. */
async function seedLadder(startedBy?: string): Promise<string> {
  const repo = `owner/repo-${repoN++}`;
  const [row] =
    await sql()`INSERT INTO ladders (repo_full_name, commit_sha, status) VALUES (${repo}, ${SHA}, 'unverified') RETURNING id::text AS id`;
  if (startedBy) {
    await sql()`INSERT INTO generation_jobs (repo_full_name, commit_sha, status, started_by) VALUES (${repo}, ${SHA}, 'fetched', ${startedBy})`;
  }
  return row.id;
}
async function seedCard(ladderId: string, level: string): Promise<string> {
  const [row] =
    await sql()`INSERT INTO review_cards (ladder_id, level, front, back) VALUES (${ladderId}, ${level}, ${`Q ${level}`}, ${`A ${level}`}) RETURNING id::text AS id`;
  return row.id;
}
/** A stored state with this due date (a card already rated once, due again at `due`). */
async function seedState(learnerId: string, cardId: string, due: Date) {
  const c = { ...scheduleNext(newCard(at(-30 * DAY)), "good", at(-30 * DAY)), due };
  await sql()`INSERT INTO card_states (learner_id, card_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review)
    VALUES (${learnerId}, ${cardId}, ${c.due}, ${c.stability}, ${c.difficulty}, ${c.elapsed_days}, ${c.scheduled_days}, ${c.learning_steps}, ${c.reps}, ${c.lapses}, ${c.state}, ${c.last_review ?? null})`;
}
async function storedState(learnerId: string, cardId: string): Promise<Card | undefined> {
  const [r] = await sql()`SELECT * FROM card_states WHERE learner_id = ${learnerId} AND card_id = ${cardId}`;
  if (!r) return undefined;
  return {
    due: r.due,
    stability: r.stability,
    difficulty: r.difficulty,
    elapsed_days: r.elapsed_days,
    scheduled_days: r.scheduled_days,
    learning_steps: r.learning_steps,
    reps: r.reps,
    lapses: r.lapses,
    state: r.state,
    last_review: r.last_review ?? undefined,
  };
}
const logRows = async (learnerId: string) =>
  await sql()`SELECT *, card_id::text AS card, learner_id::text AS learner FROM review_log WHERE learner_id = ${learnerId} ORDER BY id`;
const count = async (table: "review_log" | "card_states") =>
  Number((await sql()`SELECT count(*)::int AS n FROM ${sql()(table)}`)[0].n);
const req = (
  cardId: string,
  rating: ReviewRating,
  key: string = crypto.randomUUID(),
  elapsedMs = 1200,
): RateRequest => ({
  cardId,
  rating,
  idempotencyKey: key,
  elapsedMs,
});
const postRate = (body: unknown, cookie?: string) =>
  h.app.request(`${BASE}/api/review/rate`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const passes =
  (levels: string[]): PassedLevels =>
  async () =>
    levels;

describe("T011 review queue (AC 1, Success Criteria 1)", () => {
  test("3 due cards in unlocked L0 and 2 due in locked L1: the queue is the 3 L0 cards, oldest due first", async () => {
    const me = await learner();
    const ladder = await seedLadder(me.id);
    const [a, b, c] = [await seedCard(ladder, "L0"), await seedCard(ladder, "L0"), await seedCard(ladder, "L0")];
    const [x, y] = [await seedCard(ladder, "L1"), await seedCard(ladder, "L1")];
    await seedState(me.id, a, at(-1 * DAY));
    await seedState(me.id, b, at(-3 * DAY));
    await seedState(me.id, c, at(-2 * DAY));
    await seedState(me.id, x, at(-5 * DAY));
    await seedState(me.id, y, at(-5 * DAY));
    const q = await reviewQueue(sql(), me.id, T, noPasses);
    expect(q.cards.map((card) => card.cardId)).toEqual([b, c, a]);
    expect(q.cards[0]).toEqual({
      cardId: b,
      ladderId: ladder,
      level: "L0",
      front: "Q L0",
      back: "A L0",
      dueAt: at(-3 * DAY).toISOString(),
    });
    expect(q.nowIso).toBe(T.toISOString());
    expect(q.sessionLimitMs).toBe(300_000);
    expect(q.hasCards).toBe(true);
  });

  test("a card due exactly now is in the queue; one due 1 ms later is not and is the next due time", async () => {
    const me = await learner();
    const ladder = await seedLadder(me.id);
    const now = await seedCard(ladder, "L0");
    const later = await seedCard(ladder, "L0");
    const muchLater = await seedCard(ladder, "L0");
    await seedState(me.id, now, T);
    await seedState(me.id, later, at(1));
    await seedState(me.id, muchLater, at(DAY));
    const q = await reviewQueue(sql(), me.id, T, noPasses);
    expect(q.cards.map((card) => card.cardId)).toEqual([now]);
    expect(q.nextDueAt).toBe(at(1).toISOString());
  });

  test("New cards are due now, come after rated due cards, by card id, at most 10 per queue", async () => {
    const me = await learner();
    const ladder = await seedLadder(me.id);
    const fresh: string[] = [];
    for (let i = 0; i < 12; i++) fresh.push(await seedCard(ladder, "L0"));
    const rated = await seedCard(ladder, "L0");
    await seedState(me.id, rated, at(-MIN));
    const q = await reviewQueue(sql(), me.id, T, noPasses);
    expect(NEW_CARDS_PER_QUEUE).toBe(10);
    expect(q.cards.map((card) => card.cardId)).toEqual([rated, ...fresh.slice(0, 10)]);
    expect(q.cards[1]?.dueAt).toBe(T.toISOString());
    expect(await count("card_states")).toBe(1); // reading the queue writes nothing
  });

  test("at most 50 cards per queue, earliest due first", async () => {
    const me = await learner();
    const ladder = await seedLadder(me.id);
    for (let i = 0; i < 55; i++) await seedState(me.id, await seedCard(ladder, "L0"), at(-(i + 1) * MIN));
    const q = await reviewQueue(sql(), me.id, T, noPasses);
    expect(QUEUE_LIMIT).toBe(50);
    expect(q.cards.length).toBe(50);
    expect(q.cards[0]?.dueAt).toBe(at(-55 * MIN).toISOString());
    expect(q.cards[49]?.dueAt).toBe(at(-6 * MIN).toISOString());
  });

  test("a level locked again: its cards leave the queue and keep their state", async () => {
    const me = await learner();
    const ladder = await seedLadder(me.id);
    const card = await seedCard(ladder, "L1");
    const open = await reviewQueue(sql(), me.id, T, passes(["L0"]));
    expect(open.cards.map((c) => c.cardId)).toEqual([card]);
    await rateCard(sql(), me.id, req(card, "again"), T, passes(["L0"]));
    const before = await storedState(me.id, card);
    const locked = await reviewQueue(sql(), me.id, at(DAY), noPasses);
    expect(locked.cards).toEqual([]);
    expect(locked.nextDueAt).toBeNull();
    expect(locked.hasCards).toBe(true);
    expect(await storedState(me.id, card)).toEqual(before);
  });

  test("0 cards means hasCards false; cards only on someone else's ladder do not count", async () => {
    const me = await learner();
    const other = await learner();
    await seedLadder(me.id); // started, no cards yet
    const theirs = await seedLadder(other.id);
    await seedCard(theirs, "L0");
    await seedCard(await seedLadder(), "L0"); // nobody started it
    const q = await reviewQueue(sql(), me.id, T, noPasses);
    expect(q).toEqual({
      nowIso: T.toISOString(),
      sessionLimitMs: 300_000,
      hasCards: false,
      nextDueAt: null,
      cards: [],
    });
    expect((await reviewQueue(sql(), other.id, T, noPasses)).cards.length).toBe(1);
  });

  test("another learner's state does not move my due date", async () => {
    const me = await learner();
    const other = await learner();
    const ladder = await seedLadder(me.id);
    await sql()`INSERT INTO generation_jobs (repo_full_name, commit_sha, status, started_by)
      SELECT repo_full_name, commit_sha, 'failed', ${other.id} FROM ladders WHERE id = ${ladder}`;
    const card = await seedCard(ladder, "L0");
    await seedState(other.id, card, at(DAY));
    expect((await reviewQueue(sql(), me.id, T, noPasses)).cards.map((c) => c.dueAt)).toEqual([T.toISOString()]);
    expect((await reviewQueue(sql(), other.id, T, noPasses)).cards).toEqual([]);
  });

  test("GET /api/review/queue: 401 signed out, 200 queue signed in; always no-store", async () => {
    const out = await h.get("/api/review/queue");
    expect(out.status).toBe(401);
    expect(await out.json()).toEqual({ error: "unauthorized" });
    expect(out.headers.get("cache-control")).toBe("no-store");
    const me = await learner();
    const card = await seedCard(await seedLadder(me.id), "L0");
    const ok = await h.get("/api/review/queue", me.cookie);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    const body = (await ok.json()) as { hasCards: boolean; cards: { cardId: string }[]; nowIso: string };
    expect(body.hasCards).toBe(true);
    expect(body.cards.map((c) => c.cardId)).toEqual([card]);
    expect(Math.abs(Date.parse(body.nowIso) - Date.now())).toBeLessThan(60_000);
  });
});

describe("T011 rating (AC 2, AC 3, Success Criteria 2, 3)", () => {
  test("a New card rated Good at 2026-11-01T09:00:00Z stores exactly the library output and one log row", async () => {
    const me = await learner();
    const card = await seedCard(await seedLadder(me.id), "L0");
    const expected = lib.next(createEmptyCard(T), T, Rating.Good).card;
    const res = await rateCard(sql(), me.id, req(card, "good", "k-1", 4321), T, noPasses);
    expect(res).toEqual({ cardId: card, dueAt: expected.due.toISOString(), state: "learning", duplicate: false });
    const stored = await storedState(me.id, card);
    expect(stored).toEqual(expected);
    const [row, ...rest] = await logRows(me.id);
    expect(rest).toEqual([]);
    expect(row.learner).toBe(me.id);
    expect(row.card).toBe(card);
    expect(row.rating).toBe("good");
    expect(row.reviewed_at).toEqual(T);
    expect(row.elapsed_ms).toBe(4321);
    expect(row.idempotency_key).toBe("k-1");
    expect(row.state_before).toEqual(JSON.parse(JSON.stringify(createEmptyCard(T))));
    expect(row.state_after).toEqual(JSON.parse(JSON.stringify(expected)));
  });

  test("10 ratings, then a replay of the log from the initial state reproduces the stored state", async () => {
    const me = await learner();
    const card = await seedCard(await seedLadder(me.id), "L0");
    const ratings: ReviewRating[] = ["good", "good", "again", "hard", "good", "easy", "again", "good", "hard", "easy"];
    let now = T;
    for (const r of ratings) {
      const res = await rateCard(sql(), me.id, req(card, r), now, noPasses);
      now = new Date(Date.parse(res?.dueAt ?? "") + 7 * MIN + 123); // a little after it falls due
    }
    const rows = await logRows(me.id);
    expect(rows.map((r: { rating: string }) => r.rating)).toEqual(ratings);
    let replay: Card = createEmptyCard(rows[0].reviewed_at);
    for (const r of rows) {
      replay = lib.next(replay, r.reviewed_at, GRADE[r.rating as ReviewRating]).card;
    }
    const stored = await storedState(me.id, card);
    expect(replay).toEqual(stored as Card);
    expect(stored?.reps).toBe(10);
    expect(stored?.lapses).toBeGreaterThan(0);
  });

  test("server time is the only reviewed_at; the client sends none", async () => {
    const me = await learner();
    const card = await seedCard(await seedLadder(me.id), "L0");
    const before = Date.now();
    const res = await postRate({ ...req(card, "easy"), reviewedAt: "1999-01-01T00:00:00Z" }, me.cookie);
    expect(res.status).toBe(200);
    const [row] = await logRows(me.id);
    expect(row.reviewed_at.getTime()).toBeGreaterThanOrEqual(before);
    expect(row.reviewed_at.getTime()).toBeLessThanOrEqual(Date.now());
  });

  test("two tabs rating one card: the second rating applies to the state the first wrote", async () => {
    const me = await learner();
    const card = await seedCard(await seedLadder(me.id), "L0");
    await rateCard(sql(), me.id, req(card, "good"), T, noPasses); // the state row exists, so only the row lock orders them
    await Promise.all([
      rateCard(sql(), me.id, req(card, "good"), T, noPasses),
      rateCard(sql(), me.id, req(card, "good"), T, noPasses),
    ]);
    const rows = await logRows(me.id);
    expect(rows.length).toBe(3);
    expect(rows[1].state_before).toEqual(rows[0].state_after);
    expect(rows[2].state_before).toEqual(rows[1].state_after);
    expect((await storedState(me.id, card))?.reps).toBe(3);
  });

  test("the review log rejects UPDATE and DELETE (Success Criteria 7)", async () => {
    const me = await learner();
    const card = await seedCard(await seedLadder(me.id), "L0");
    await rateCard(sql(), me.id, req(card, "good"), T, noPasses);
    await expect((async () => await sql()`UPDATE review_log SET rating = 'easy'`)()).rejects.toThrow(/append-only/);
    await expect((async () => await sql()`DELETE FROM review_log`)()).rejects.toThrow(/append-only/);
    expect((await logRows(me.id)).map((r: { rating: string }) => r.rating)).toEqual(["good"]);
  });
});

describe("T011 idempotency (AC 6, Success Criteria 5)", () => {
  test("the same request twice with one key: one log row, reps advanced once, second answer is a duplicate", async () => {
    const me = await learner();
    const card = await seedCard(await seedLadder(me.id), "L0");
    const body = req(card, "good", "same-key");
    const first = await postRate(body, me.cookie);
    const second = await postRate(body, me.cookie);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const a = (await first.json()) as { duplicate: boolean; dueAt: string };
    const b = (await second.json()) as { duplicate: boolean; dueAt: string };
    expect(a.duplicate).toBe(false);
    expect(b).toEqual({ ...a, duplicate: true });
    expect((await logRows(me.id)).length).toBe(1);
    expect((await storedState(me.id, card))?.reps).toBe(1);
  });

  test("the same key sent twice at once still makes one row", async () => {
    const me = await learner();
    const card = await seedCard(await seedLadder(me.id), "L0");
    const results = await Promise.all([
      rateCard(sql(), me.id, req(card, "good", "race"), T, noPasses),
      rateCard(sql(), me.id, req(card, "good", "race"), T, noPasses),
    ]);
    expect(results.map((r) => r?.duplicate).sort()).toEqual([false, true]);
    expect((await logRows(me.id)).length).toBe(1);
    expect((await storedState(me.id, card))?.reps).toBe(1);
  });

  test("a key is per learner: another learner may use the same key", async () => {
    const me = await learner();
    const other = await learner();
    const mine = await seedCard(await seedLadder(me.id), "L0");
    const theirs = await seedCard(await seedLadder(other.id), "L0");
    expect((await rateCard(sql(), me.id, req(mine, "good", "k"), T, noPasses))?.duplicate).toBe(false);
    expect((await rateCard(sql(), other.id, req(theirs, "good", "k"), T, noPasses))?.duplicate).toBe(false);
  });
});

describe("T011 auth and ownership (AC 7, Success Criteria 6)", () => {
  test("no session cookie: 401, nothing written", async () => {
    const me = await learner();
    const card = await seedCard(await seedLadder(me.id), "L0");
    const res = await postRate(req(card, "good"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await count("review_log")).toBe(0);
  });

  test("another learner's card, a locked level, unknown and non-numeric ids: 404, no state change", async () => {
    const me = await learner();
    const other = await learner();
    const theirLadder = await seedLadder(other.id);
    const theirs = await seedCard(theirLadder, "L0");
    await rateCard(sql(), other.id, req(theirs, "good"), T, noPasses);
    const theirState = await storedState(other.id, theirs);
    const locked = await seedCard(await seedLadder(me.id), "L1");
    for (const cardId of [theirs, locked, "987654", "abc", "1 OR 1=1", "0", "99999999999999999999", ""]) {
      const res = await postRate(req(cardId, "good"), me.cookie);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not-found" });
    }
    expect(await count("review_log")).toBe(1);
    expect(await count("card_states")).toBe(1);
    expect(await storedState(other.id, theirs)).toEqual(theirState);
  });

  test("bad bodies: 400 invalid-request; Rating.Manual is never accepted", async () => {
    const me = await learner();
    const card = await seedCard(await seedLadder(me.id), "L0");
    const ok = req(card, "good");
    const bad: unknown[] = [
      { ...ok, rating: "manual" },
      { ...ok, rating: "Manual" },
      { ...ok, rating: 0 },
      { ...ok, rating: 3 },
      { ...ok, rating: "Good" },
      { ...ok, rating: "toString" },
      { ...ok, elapsedMs: -1 },
      { ...ok, elapsedMs: "100" },
      { ...ok, elapsedMs: null },
      { ...ok, idempotencyKey: undefined },
      { ...ok, idempotencyKey: 42 },
      { ...ok, idempotencyKey: "" },
      { ...ok, idempotencyKey: "k".repeat(201) },
      { ...ok, cardId: 7 },
      [],
      null,
      "not json",
    ];
    for (const body of bad) {
      const res = await postRate(body, me.cookie);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid-request" });
    }
    expect(checkRateRequest({ ...ok, elapsedMs: Number.POSITIVE_INFINITY })).toBeUndefined();
    expect(checkRateRequest({ ...ok, elapsedMs: Number.NaN })).toBeUndefined();
    expect(checkRateRequest(ok)).toEqual(ok);
    expect(await count("review_log")).toBe(0);
  });
});

describe("T011 /review page", () => {
  test("signed out goes through sign-in with a return to /review; signed in gets the client; no-store", async () => {
    const out = await h.get("/review");
    expect(out.status).toBe(302);
    expect(out.headers.get("location")).toBe(`/auth/github?next=${encodeURIComponent("/review")}`);
    expect(out.headers.get("cache-control")).toBe("no-store");
    const me = await learner();
    const page = await h.get("/review", me.cookie);
    expect(page.status).toBe(200);
    expect(page.headers.get("cache-control")).toBe("no-store");
    expect(await page.text()).toContain('<div id="root">');
  });

  test("sign-in keeps exactly /review as a return target and refuses look-alikes", async () => {
    const returnCookie = async (next: string) =>
      (await h.get(`/auth/github?next=${encodeURIComponent(next)}`)).headers
        .getSetCookie()
        .find((c) => c.startsWith("il_return_to="));
    expect(await returnCookie("/review")).toContain("il_return_to=%2Freview");
    for (const bad of [
      "/review/x",
      "//review",
      "/review?x=1",
      "/reviews",
      "/review/",
      "/Review",
      "/review%0d%0aX: y",
    ]) {
      expect(await returnCookie(bad)).toBeUndefined();
    }
  });
});
