// T015: offline review: the offline pack, the client reviewedAt rule in rateCard, and POST /api/review/sync.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createEmptyCard, fsrs, generatorParameters, Rating } from "ts-fsrs";
import { noPasses, type PassedLevels } from "../src/server/ladder-view.ts";
import { offlinePack, syncRatings } from "../src/server/offline.ts";
import { checkRateRequest, rateCard } from "../src/server/review.ts";
import { type Card, newCard, scheduleNext } from "../src/server/scheduler.ts";
import type { CardStateJson, SyncRating, SyncResponse } from "../src/shared/offline.ts";
import type { Rating as ReviewRating } from "../src/shared/review.ts";
import { V0_REPOS } from "./support/github-fixtures.ts";
import { BASE, startHarness } from "./support/start-harness.ts";

const SHA: string = V0_REPOS["developit/mitt"];
const T = new Date("2026-11-01T09:00:00Z");
const at = (ms: number) => new Date(T.getTime() + ms);
const iso = (ms: number) => at(ms).toISOString();
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

async function learner(): Promise<{ cookie: string; id: string; githubId: number }> {
  const cookie = await h.learner();
  const [u] = await sql()`SELECT id::text AS id, github_id::int AS gid FROM users ORDER BY users.id DESC LIMIT 1`;
  return { cookie, id: u.id, githubId: u.gid };
}
let repoN = 0;
async function seedLadder(startedBy?: string): Promise<string> {
  const repo = `owner/offline-${repoN++}`;
  const [row] =
    await sql()`INSERT INTO ladders (repo_full_name, commit_sha, status) VALUES (${repo}, ${SHA}, 'unverified') RETURNING id::text AS id`;
  if (startedBy) {
    await sql()`INSERT INTO generation_jobs (repo_full_name, commit_sha, status, started_by) VALUES (${repo}, ${SHA}, 'fetched', ${startedBy})`;
  }
  return row.id;
}
async function seedCard(ladderId: string, level = "L0"): Promise<string> {
  const [row] =
    await sql()`INSERT INTO review_cards (ladder_id, level, front, back) VALUES (${ladderId}, ${level}, 'Q', 'A') RETURNING id::text AS id`;
  return row.id;
}
async function seedState(learnerId: string, cardId: string, due: Date) {
  const c = { ...scheduleNext(newCard(at(-30 * DAY)), "good", at(-30 * DAY)), due };
  await sql()`INSERT INTO card_states (learner_id, card_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review)
    VALUES (${learnerId}, ${cardId}, ${c.due}, ${c.stability}, ${c.difficulty}, ${c.elapsed_days}, ${c.scheduled_days}, ${c.learning_steps}, ${c.reps}, ${c.lapses}, ${c.state}, ${c.last_review ?? null})`;
}
async function storedState(learnerId: string, cardId: string): Promise<Card> {
  const [r] = await sql()`SELECT * FROM card_states WHERE learner_id = ${learnerId} AND card_id = ${cardId}`;
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
const asJson = (c: Card): CardStateJson => ({
  due: c.due.toISOString(),
  stability: c.stability,
  difficulty: c.difficulty,
  elapsed_days: c.elapsed_days,
  scheduled_days: c.scheduled_days,
  learning_steps: c.learning_steps,
  reps: c.reps,
  lapses: c.lapses,
  state: c.state as CardStateJson["state"],
  last_review: c.last_review ? c.last_review.toISOString() : null,
});
const logRows = async (learnerId: string) =>
  await sql()`SELECT *, card_id::text AS card FROM review_log WHERE learner_id = ${learnerId} ORDER BY id`;
const count = async (table: "review_log" | "card_states") =>
  Number((await sql()`SELECT count(*)::int AS n FROM ${sql()(table)}`)[0].n);
const rating = (
  cardId: string,
  r: ReviewRating,
  reviewedAt: string,
  key: string = crypto.randomUUID(),
): SyncRating => ({ cardId, rating: r, idempotencyKey: key, elapsedMs: 1500, reviewedAt });
/** Replays one card's log from createEmptyCard(first reviewed_at), exactly as T011's replay test does. */
async function replay(learnerId: string, cardId: string): Promise<Card> {
  const rows = (await logRows(learnerId)).filter((r: { card: string }) => r.card === cardId);
  let card: Card = createEmptyCard(rows[0].reviewed_at);
  for (const r of rows) card = lib.next(card, r.reviewed_at, GRADE[r.rating as ReviewRating]).card;
  return card;
}
const post = (path: string, body: unknown, cookie?: string) =>
  h.app.request(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const passes =
  (levels: string[]): PassedLevels =>
  async () =>
    levels;

describe("T015 client reviewedAt rule in rateCard (AC 3, Success Criteria 4)", () => {
  /** A card whose last review is at T (rated once at T); then one rating at server time T+10 min with `client`. */
  async function rateAfterOne(client: string | undefined) {
    const me = await learner();
    const card = await seedCard(await seedLadder(me.id));
    await rateCard(sql(), me.id, { cardId: card, rating: "good", idempotencyKey: "k1", elapsedMs: 1 }, T, noPasses);
    const second = { cardId: card, rating: "good" as const, idempotencyKey: "k2", elapsedMs: 1 };
    const res = await rateCard(
      sql(),
      me.id,
      client ? { ...second, reviewedAt: client } : second,
      at(10 * MIN),
      noPasses,
    );
    const rows = await logRows(me.id);
    return { res, reviewedAt: rows[1].reviewed_at as Date, me, card };
  }

  test("inside the window (after last review, not after server + 5 min): the client time is used", async () => {
    const { res, reviewedAt } = await rateAfterOne(iso(3 * MIN));
    expect(reviewedAt).toEqual(at(3 * MIN));
    expect(res?.usedClientTime).toBe(true);
  });

  test("exactly server time + 5 min is accepted; 1 ms later is rejected for server time", async () => {
    const edge = await rateAfterOne(iso(10 * MIN + 5 * MIN));
    expect(edge.reviewedAt).toEqual(at(15 * MIN));
    expect(edge.res?.usedClientTime).toBe(true);
    const over = await rateAfterOne(iso(10 * MIN + 5 * MIN + 1));
    expect(over.reviewedAt).toEqual(at(10 * MIN));
    expect(over.res?.usedClientTime).toBe(false);
  });

  test("server time + 2 h (Success Criteria 4): server time, usedClientTime false", async () => {
    const { res, reviewedAt } = await rateAfterOne(iso(10 * MIN + 2 * 60 * MIN));
    expect(reviewedAt).toEqual(at(10 * MIN));
    expect(res?.usedClientTime).toBe(false);
  });

  test("before or equal to the last review: server time", async () => {
    for (const client of [iso(-1), iso(0)]) {
      await h.reset();
      const { res, reviewedAt } = await rateAfterOne(client);
      expect(reviewedAt).toEqual(at(10 * MIN));
      expect(res?.usedClientTime).toBe(false);
    }
    await h.reset();
    const justAfter = await rateAfterOne(iso(1));
    expect(justAfter.reviewedAt).toEqual(at(1));
  });

  test("rejected client time when the server clock is behind the last review: max(server now, last review)", async () => {
    const me = await learner();
    const card = await seedCard(await seedLadder(me.id));
    await rateCard(sql(), me.id, rating(card, "good", iso(0)), at(MIN), noPasses); // last review T (client time)
    const res = await rateCard(sql(), me.id, rating(card, "good", iso(-5)), at(-MIN), noPasses);
    expect(res?.usedClientTime).toBe(false);
    expect((await logRows(me.id))[1].reviewed_at).toEqual(T);
  });

  test("no reviewedAt: T011 behaviour unchanged (server time, no usedClientTime field)", async () => {
    const me = await learner();
    const card = await seedCard(await seedLadder(me.id));
    const res = await rateCard(
      sql(),
      me.id,
      { cardId: card, rating: "good", idempotencyKey: "k", elapsedMs: 1 },
      T,
      noPasses,
    );
    expect(res && "usedClientTime" in res).toBe(false);
    expect((await logRows(me.id))[0].reviewed_at).toEqual(T);
  });

  test("checkRateRequest: reviewedAt optional; must be an ISO date-time string", () => {
    const ok = { cardId: "1", rating: "good", idempotencyKey: "k", elapsedMs: 1 };
    expect(checkRateRequest(ok)).toEqual(ok as never);
    expect(checkRateRequest({ ...ok, reviewedAt: "2026-11-01T09:00:00.000Z" })?.reviewedAt).toBe(
      "2026-11-01T09:00:00.000Z",
    );
    expect(checkRateRequest({ ...ok, reviewedAt: "2026-11-01T10:00:00+01:00" })?.reviewedAt).toBe(
      "2026-11-01T10:00:00+01:00",
    );
    for (const bad of [
      42,
      null,
      "",
      "yesterday",
      "2026-11-01",
      "2026-13-01T00:00:00Z",
      "2026-11-01T09:00:00",
      "x".repeat(50),
    ]) {
      expect(checkRateRequest({ ...ok, reviewedAt: bad })).toBeUndefined();
    }
  });

  test("POST /api/review/rate accepts the optional reviewedAt and reports usedClientTime", async () => {
    const me = await learner();
    const card = await seedCard(await seedLadder(me.id));
    const now = Date.now();
    const client = new Date(now - 30_000).toISOString();
    const res = await post("/api/review/rate", { ...rating(card, "good", client) }, me.cookie);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { usedClientTime: boolean }).usedClientTime).toBe(true);
    expect((await logRows(me.id))[0].reviewed_at.toISOString()).toBe(client);
    const bad = await post("/api/review/rate", { ...rating(card, "good", "not a time") }, me.cookie);
    expect(bad.status).toBe(400);
  });
});

describe("T015 sync (AC 3, Success Criteria 3)", () => {
  test("ratings are applied in reviewedAt order; results keep request order; card = the stored state", async () => {
    const me = await learner();
    const card = await seedCard(await seedLadder(me.id));
    const batch = [
      rating(card, "hard", iso(20 * MIN), "c"),
      rating(card, "good", iso(0), "a"),
      rating(card, "again", iso(10 * MIN), "b"),
    ];
    const res = await syncRatings(sql(), me.id, { ratings: batch }, at(60 * MIN), noPasses);
    expect(typeof res).toBe("object");
    const { results } = res as SyncResponse;
    expect(results.map((r) => [r.idempotencyKey, r.status, r.usedClientTime])).toEqual([
      ["c", "applied", true],
      ["a", "applied", true],
      ["b", "applied", true],
    ]);
    const rows = await logRows(me.id);
    expect(rows.map((r: { idempotency_key: string }) => r.idempotency_key)).toEqual(["a", "b", "c"]);
    expect(rows.map((r: { reviewed_at: Date }) => r.reviewed_at)).toEqual([at(0), at(10 * MIN), at(20 * MIN)]);
    const stored = await storedState(me.id, card);
    expect(results[0]?.card).toEqual(asJson(stored)); // "c" was applied last
    expect(results[1]?.card).toEqual(asJson(fromLog(rows[0].state_after))); // "a" was applied first
    expect(await replay(me.id, card)).toEqual(stored);
  });

  test("equal reviewedAt: stable order (request order)", async () => {
    const me = await learner();
    const card = await seedCard(await seedLadder(me.id));
    await syncRatings(
      sql(),
      me.id,
      { ratings: [rating(card, "good", iso(0), "first"), rating(card, "easy", iso(0), "second")] },
      at(MIN),
      noPasses,
    );
    expect((await logRows(me.id)).map((r: { idempotency_key: string }) => r.idempotency_key)).toEqual([
      "first",
      "second",
    ]);
  });

  test("a rating sent twice (same batch and a later batch) makes one log row; duplicate returns the current state", async () => {
    const me = await learner();
    const ladder = await seedLadder(me.id);
    const [a, b] = [await seedCard(ladder), await seedCard(ladder)];
    const first = rating(a, "good", iso(0), "dup");
    const out1 = (await syncRatings(sql(), me.id, { ratings: [first, first] }, at(MIN), noPasses)) as SyncResponse;
    expect(out1.results.map((r) => r.status)).toEqual(["applied", "duplicate"]);
    await syncRatings(sql(), me.id, { ratings: [rating(a, "again", iso(30 * MIN), "later")] }, at(31 * MIN), noPasses);
    const out2 = (await syncRatings(
      sql(),
      me.id,
      { ratings: [first, rating(b, "good", iso(0), "other")] },
      at(32 * MIN),
      noPasses,
    )) as SyncResponse;
    expect(out2.results.map((r) => r.status)).toEqual(["duplicate", "applied"]);
    expect(out2.results[0]?.card).toEqual(asJson(await storedState(me.id, a))); // current, after "later"
    expect(out2.results[0]?.cardId).toBe(a);
    expect((await logRows(me.id)).length).toBe(3);
    expect((await storedState(me.id, a)).reps).toBe(2);
  });

  test("not-found and invalid items write nothing and never block the others", async () => {
    const me = await learner();
    const other = await learner();
    const ladder = await seedLadder(me.id);
    const ok = await seedCard(ladder, "L0");
    const locked = await seedCard(ladder, "L1");
    const theirs = await seedCard(await seedLadder(other.id), "L0");
    const ratings: unknown[] = [
      rating(locked, "good", iso(0), "locked"),
      rating(theirs, "good", iso(0), "theirs"),
      rating("987654", "good", iso(0), "unknown"),
      { ...rating(ok, "good", iso(0), "bad-rating"), rating: "manual" },
      { cardId: ok, rating: "good", idempotencyKey: "no-time", elapsedMs: 1 },
      { ...rating(ok, "good", iso(0), "bad-time"), reviewedAt: "soon" },
      { ...rating(ok, "good", iso(0), ""), idempotencyKey: "" },
      "not an object",
      rating(ok, "good", iso(0), "fine"),
    ];
    const out = (await syncRatings(sql(), me.id, { ratings }, at(MIN), noPasses)) as SyncResponse;
    expect(out.results.map((r) => [r.idempotencyKey, r.status])).toEqual([
      ["locked", "not-found"],
      ["theirs", "not-found"],
      ["unknown", "not-found"],
      ["bad-rating", "invalid"],
      ["no-time", "invalid"],
      ["bad-time", "invalid"],
      ["", "invalid"],
      ["", "invalid"],
      ["fine", "applied"],
    ]);
    expect(out.results[0]).toEqual({ idempotencyKey: "locked", cardId: locked, status: "not-found" });
    expect(await count("review_log")).toBe(1);
    expect(await count("card_states")).toBe(1);
  });

  test("offline batches with accepted and rejected client times: the log replays to every stored card state", async () => {
    const me = await learner();
    const ladder = await seedLadder(me.id);
    const cards = [await seedCard(ladder), await seedCard(ladder), await seedCard(ladder)];
    await seedState(me.id, cards[2] as string, at(-DAY)); // rated 30 days ago, never logged: replay only cards 0 and 1
    const seq: ReviewRating[] = ["good", "again", "good", "hard", "easy", "good"];
    let server = 0;
    for (let day = 0; day < 6; day++) {
      server = day * DAY + 8 * 60 * MIN;
      const batch = cards.slice(0, 2).flatMap((c, i) => [
        rating(c, seq[(day + i) % 6] as ReviewRating, iso(server - 3 * 60 * MIN + i * MIN)), // offline, accepted
        rating(c, seq[(day + i + 1) % 6] as ReviewRating, iso(server + 3 * 60 * MIN)), // clock ahead: rejected
      ]);
      await syncRatings(sql(), me.id, { ratings: batch }, at(server), noPasses);
    }
    for (const c of cards.slice(0, 2)) {
      const stored = await storedState(me.id, c);
      expect(stored.reps).toBe(12);
      const replayed = await replay(me.id, c);
      for (const k of Object.keys(stored) as (keyof Card)[]) expect([k, replayed[k]]).toEqual([k, stored[k]]);
    }
  });

  test("two devices rated one card offline: both apply in reviewedAt order per sync; the later sync gets the server state", async () => {
    const me = await learner();
    const card = await seedCard(await seedLadder(me.id));
    const phone = [rating(card, "good", iso(0), "p1"), rating(card, "good", iso(2 * DAY), "p2")];
    const laptop = [rating(card, "again", iso(DAY), "l1")];
    await syncRatings(sql(), me.id, { ratings: phone }, at(3 * DAY), noPasses);
    const out = (await syncRatings(sql(), me.id, { ratings: laptop }, at(3 * DAY + MIN), noPasses)) as SyncResponse;
    expect(out.results[0]).toMatchObject({ status: "applied", usedClientTime: false }); // before the last review
    expect(out.results[0]?.card).toEqual(asJson(await storedState(me.id, card)));
    const rows = await logRows(me.id);
    expect(rows.map((r: { reviewed_at: Date }) => r.reviewed_at)).toEqual([at(0), at(2 * DAY), at(3 * DAY + MIN)]);
    expect(await replay(me.id, card)).toEqual(await storedState(me.id, card));
  });

  test("batch limits and bodies: 200 ok, 201 too-many, bad body invalid-request", async () => {
    const me = await learner();
    const card = await seedCard(await seedLadder(me.id));
    const many = (n: number) => Array.from({ length: n }, (_, i) => rating(card, "good", iso(i * MIN)));
    expect(await syncRatings(sql(), me.id, { ratings: many(201) }, at(DAY), noPasses)).toBe("too-many");
    for (const bad of [null, [], "x", {}, { ratings: "x" }, { ratings: null }]) {
      expect(await syncRatings(sql(), me.id, bad, at(DAY), noPasses)).toBe("invalid-request");
    }
    expect(await count("review_log")).toBe(0);
    const ok = (await syncRatings(sql(), me.id, { ratings: many(200) }, at(DAY), noPasses)) as SyncResponse;
    expect(ok.results.every((r) => r.status === "applied")).toBe(true);
    expect(await count("review_log")).toBe(200);
  });

  test("POST /api/review/sync: 401 signed out, 400 too-many / invalid-request, 200 results; no-store", async () => {
    const out = await post("/api/review/sync", { ratings: [] });
    expect(out.status).toBe(401);
    expect(out.headers.get("cache-control")).toBe("no-store");
    const me = await learner();
    const card = await seedCard(await seedLadder(me.id));
    const tooMany = await post(
      "/api/review/sync",
      { ratings: Array.from({ length: 201 }, () => rating(card, "good", new Date().toISOString())) },
      me.cookie,
    );
    expect(tooMany.status).toBe(400);
    expect(await tooMany.json()).toEqual({ error: "too-many" });
    const bad = await post("/api/review/sync", "not json", me.cookie);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid-request" });
    const ok = await post(
      "/api/review/sync",
      { ratings: [rating(card, "good", new Date(Date.now() - MIN).toISOString(), "http")] },
      me.cookie,
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    const body = (await ok.json()) as SyncResponse;
    expect(body.results[0]).toMatchObject({
      idempotencyKey: "http",
      cardId: card,
      status: "applied",
      usedClientTime: true,
    });
    expect(body.results[0]?.card).toEqual(asJson(await storedState(me.id, card)));
  });
});

describe("T015 sync learnerId (QA F3: a queue never applies under another account)", () => {
  test("learnerId of the session learner: applied as before; absent: applied as before", async () => {
    const me = await learner();
    const ladder = await seedLadder(me.id);
    const [a, b] = [await seedCard(ladder), await seedCard(ladder)];
    const same = (await syncRatings(
      sql(),
      me.id,
      { learnerId: me.id, ratings: [rating(a, "good", iso(0), "same")] },
      at(MIN),
      noPasses,
    )) as SyncResponse;
    expect(same.results.map((r) => r.status)).toEqual(["applied"]);
    const absent = (await syncRatings(
      sql(),
      me.id,
      { ratings: [rating(b, "good", iso(0), "absent")] },
      at(MIN),
      noPasses,
    )) as SyncResponse;
    expect(absent.results.map((r) => r.status)).toEqual(["applied"]);
    expect(await count("review_log")).toBe(2);
  });

  test("another learner's id: wrong-learner, nothing written; a non-string learnerId: invalid-request", async () => {
    const me = await learner();
    const other = await learner();
    const card = await seedCard(await seedLadder(me.id));
    const ratings = [rating(card, "good", iso(0), "queued")];
    expect(await syncRatings(sql(), me.id, { learnerId: other.id, ratings }, at(MIN), noPasses)).toBe(
      "wrong-learner",
    );
    for (const learnerId of [Number(me.id), null, {}, [me.id]]) {
      expect(await syncRatings(sql(), me.id, { learnerId, ratings }, at(MIN), noPasses)).toBe("invalid-request");
    }
    expect(await count("review_log")).toBe(0);
    expect(await count("card_states")).toBe(0);
  });

  test("POST /api/review/sync: 409 wrong-learner and zero rows; 400 for a non-string learnerId; 200 for the own id", async () => {
    const me = await learner();
    const other = await learner();
    const card = await seedCard(await seedLadder(me.id));
    const ratings = [rating(card, "good", new Date(Date.now() - MIN).toISOString(), "http")];
    const wrong = await post("/api/review/sync", { learnerId: other.id, ratings }, me.cookie);
    expect(wrong.status).toBe(409);
    expect(await wrong.json()).toEqual({ error: "wrong-learner" });
    expect(await count("review_log")).toBe(0);
    expect(await count("card_states")).toBe(0);
    const bad = await post("/api/review/sync", { learnerId: 5, ratings }, me.cookie);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid-request" });
    const ok = await post("/api/review/sync", { learnerId: me.id, ratings }, me.cookie);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as SyncResponse).results[0]?.status).toBe("applied");
    expect(await count("review_log")).toBe(1);
  });
});

describe("T015 offline pack (AC 2)", () => {
  test("unlocked levels of started ladders, due within 7 days, plus up to 10 New cards; due ascending; states attached", async () => {
    const me = await learner();
    const other = await learner();
    const ladder = await seedLadder(me.id);
    const soon = await seedCard(ladder);
    const overdue = await seedCard(ladder);
    const edge = await seedCard(ladder);
    const far = await seedCard(ladder);
    const lockedCard = await seedCard(ladder, "L1");
    const fresh: string[] = [];
    for (let i = 0; i < 12; i++) fresh.push(await seedCard(ladder));
    await seedState(me.id, soon, at(2 * DAY));
    await seedState(me.id, overdue, at(-DAY));
    await seedState(me.id, edge, at(7 * DAY));
    await seedState(me.id, far, at(7 * DAY + 1));
    await seedState(me.id, lockedCard, at(DAY));
    await seedCard(await seedLadder(other.id)); // someone else's ladder
    const pack = await offlinePack(sql(), me.id, T, noPasses);
    expect(pack.learnerId).toBe(me.id);
    expect(pack.githubId).toBe(me.githubId);
    expect(pack.generatedAt).toBe(T.toISOString());
    expect(pack.sessionLimitMs).toBe(300_000);
    expect(pack.cards.map((c) => c.cardId)).toEqual([overdue, ...fresh.slice(0, 10), soon, edge]);
    expect(pack.cards[0]?.cardState).toEqual(asJson(await storedState(me.id, overdue)));
    expect(pack.cards[1]).toEqual({
      cardId: fresh[0] as string,
      ladderId: ladder,
      level: "L0",
      front: "Q",
      back: "A",
      dueAt: T.toISOString(),
      cardState: null,
    });
    const open = await offlinePack(sql(), me.id, T, passes(["L0"]));
    expect(open.cards.map((c) => c.cardId)).toContain(lockedCard);
  });

  test("at most 200 cards, earliest due first", async () => {
    const me = await learner();
    const ladder = await seedLadder(me.id);
    for (let i = 0; i < 205; i++) await seedState(me.id, await seedCard(ladder), at(i * MIN));
    const pack = await offlinePack(sql(), me.id, T, noPasses);
    expect(pack.cards.length).toBe(200);
    expect(pack.cards[0]?.dueAt).toBe(T.toISOString());
    expect(pack.cards[199]?.dueAt).toBe(iso(199 * MIN));
  });

  test("GET /api/review/offline-pack: 401 signed out, 200 signed in; no-store", async () => {
    const out = await h.get("/api/review/offline-pack");
    expect(out.status).toBe(401);
    expect(out.headers.get("cache-control")).toBe("no-store");
    const me = await learner();
    const card = await seedCard(await seedLadder(me.id));
    const ok = await h.get("/api/review/offline-pack", me.cookie);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    const body = (await ok.json()) as { cards: { cardId: string }[]; githubId: number };
    expect(body.cards.map((c) => c.cardId)).toEqual([card]);
    expect(body.githubId).toBe(me.githubId);
  });
});

function fromLog(j: Record<string, unknown>): Card {
  return {
    ...(j as unknown as Card),
    due: new Date(j.due as string),
    last_review: j.last_review ? new Date(j.last_review as string) : undefined,
  };
}
