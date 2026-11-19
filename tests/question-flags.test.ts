import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { McqAttempt } from "../src/server/mcq-test.ts";
import { seedPool } from "./support/mcq-seed.ts";
import { BASE, startHarness } from "./support/start-harness.ts";

let h: Awaited<ReturnType<typeof startHarness>>;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.db.drop();
});
beforeEach(async () => {
  await h.reset();
  await h.db.sql`TRUNCATE question_flags`;
});

const sql = () => h.db.sql;
const SHA = "3f2a9c1".padEnd(40, "0");
let n = 0;

async function learner() {
  const cookie = await h.learner();
  const [{ id }] = await sql()`SELECT max(id)::text AS id FROM users`;
  return { cookie, id: id as string };
}
/** A ladder with `count` MCQs (each with a card) at L0, started by every learner in `by`. */
async function ladderFor(by: { id: string }[], count = 12) {
  const repo = `owner/flag-${n++}`;
  await sql()`INSERT INTO repo_snapshots (repo_full_name, commit_sha, default_branch, archived, readme, topics, languages, dep_files, open_issues, good_first_issues, tree, tree_truncated)
    VALUES (${repo}, ${SHA}, 'main', false, 'r', '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, 0, 0, '[]'::jsonb, false)`;
  const [{ id }] =
    await sql()`INSERT INTO ladders (repo_full_name, commit_sha, status) VALUES (${repo}, ${SHA}, 'unverified') RETURNING id::text AS id`;
  // listLadders joins on started_by only, and the table allows one non-failed job per repo + SHA: the first learner's
  // job is `done`, the others get `failed` ones (they still count as having started the ladder).
  for (const [i, l] of by.entries())
    await sql()`INSERT INTO generation_jobs (repo_full_name, commit_sha, status, started_by) VALUES (${repo}, ${SHA}, ${i === 0 ? "done" : "failed"}, ${l.id})`;
  const ladder = { ladderId: id as string, repo, sha: SHA };
  return { ladder, pool: await seedPool(sql(), ladder, "L0", count) };
}
const flag = (cookie: string | undefined, body: unknown) =>
  h.app.request(`${BASE}/api/flags`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
const queue = async (cookie: string) =>
  ((await (await h.get("/api/review/queue", cookie)).json()) as { cards: { cardId: string }[] }).cards.map(
    (c) => c.cardId,
  );
const startAttempt = async (cookie: string, ladderId: string) =>
  (await (
    await h.app.request(`${BASE}/api/ladders/${ladderId}/levels/L0/mcq-attempts`, {
      method: "POST",
      headers: { cookie },
    })
  ).json()) as McqAttempt;
const status = async (table: "review_cards" | "mcqs", id: string) =>
  (await sql().unsafe(`SELECT status FROM ${table} WHERE id = ${id}`))[0].status as string;

describe("T016 flagQuestion: one flag per learner, per-learner hide", () => {
  test("a repeat flag is a 200 no-op (1 row); the card leaves A's queue and stays in B's; the MCQ is not drawn for A", async () => {
    const a = await learner();
    const b = await learner();
    const { ladder, pool } = await ladderFor([a, b]);
    const q = pool[0] as { id: string; cardId: string };
    expect(await queue(a.cookie)).toContain(q.cardId);
    expect((await flag(a.cookie, { kind: "card", id: q.cardId, reason: "<b>wrong</b>" })).status).toBe(200);
    const again = await flag(a.cookie, { kind: "card", id: q.cardId });
    expect(again.status).toBe(200);
    expect(again.headers.get("cache-control")).toBe("no-store");
    expect(await sql()`SELECT reason FROM question_flags`).toEqual([{ reason: "<b>wrong</b>" }]);
    expect(await queue(a.cookie)).not.toContain(q.cardId);
    expect(await queue(b.cookie)).toContain(q.cardId);
    expect(await status("review_cards", q.cardId)).toBe("active");

    expect((await flag(a.cookie, { kind: "mcq", id: q.id })).status).toBe(200);
    for (let i = 0; i < 6; i++) {
      await sql()`DELETE FROM mcq_attempts`;
      expect((await startAttempt(a.cookie, ladder.ladderId)).questions.map((x) => x.id)).not.toContain(q.id);
    }
    // not removed, still in the pool for B (11 of 12 drawn for A, all 12 eligible for B: 10 of them drawn)
    expect(await status("mcqs", q.id)).toBe("active");
    expect(h.state.regenerate).toEqual([]);
  });

  test("the offline pack leaves out the learner's flagged card", async () => {
    const a = await learner();
    const { pool } = await ladderFor([a]);
    const q = pool[0] as { cardId: string };
    const ids = async () =>
      ((await (await h.get("/api/review/offline-pack", a.cookie)).json()) as { cards: { cardId: string }[] }).cards.map(
        (c) => c.cardId,
      );
    expect(await ids()).toContain(q.cardId);
    await flag(a.cookie, { kind: "card", id: q.cardId });
    expect(await ids()).not.toContain(q.cardId);
  });

  test("reason: 280 chars kept, 281 refused (400); bad kind, bad id and non-string reason are 400", async () => {
    const a = await learner();
    const { pool } = await ladderFor([a]);
    const id = (pool[0] as { cardId: string }).cardId;
    expect((await flag(a.cookie, { kind: "card", id, reason: "x".repeat(281) })).status).toBe(400);
    expect((await flag(a.cookie, { kind: "other", id })).status).toBe(400);
    expect((await flag(a.cookie, { kind: "card", id: "abc" })).status).toBe(400);
    expect((await flag(a.cookie, { kind: "card", id, reason: 5 })).status).toBe(400);
    expect((await flag(a.cookie, "nope")).status).toBe(400);
    expect(await sql()`SELECT count(*)::int AS n FROM question_flags`).toEqual([{ n: 0 }]);
    expect((await flag(a.cookie, { kind: "card", id, reason: "x".repeat(280) })).status).toBe(200);
  });

  test("401 without a session; 404 for a ladder the learner has not started and for an unknown id (nothing written)", async () => {
    const a = await learner();
    const other = await learner();
    const { pool } = await ladderFor([other]);
    const q = pool[0] as { id: string; cardId: string };
    expect((await flag(undefined, { kind: "card", id: q.cardId })).status).toBe(401);
    expect((await flag(a.cookie, { kind: "card", id: q.cardId })).status).toBe(404);
    expect((await flag(a.cookie, { kind: "mcq", id: q.id })).status).toBe(404);
    expect((await flag(a.cookie, { kind: "mcq", id: "999999" })).status).toBe(404);
    expect(await sql()`SELECT count(*)::int AS n FROM question_flags`).toEqual([{ n: 0 }]);
  });
});

describe("T016 threshold: removal and one regenerate event", () => {
  test("2 distinct flaggers leave status active; the 3rd removes the card and sends one event; a 4th sends nothing; the same learner x3 counts 1", async () => {
    const ls = [await learner(), await learner(), await learner(), await learner()];
    const { ladder, pool } = await ladderFor(ls);
    const q = pool[0] as { cardId: string };
    const [a, b, c, d] = ls as [(typeof ls)[0], (typeof ls)[0], (typeof ls)[0], (typeof ls)[0]];
    for (let i = 0; i < 3; i++) await flag(a.cookie, { kind: "card", id: q.cardId });
    await flag(b.cookie, { kind: "card", id: q.cardId });
    expect(await status("review_cards", q.cardId)).toBe("active");
    expect(h.state.regenerate).toEqual([]);
    expect(await queue(c.cookie)).toContain(q.cardId);

    expect((await flag(c.cookie, { kind: "card", id: q.cardId })).status).toBe(200);
    expect(await status("review_cards", q.cardId)).toBe("removed");
    const [chunk] = await sql()`SELECT chunk_id::text AS c FROM review_cards WHERE id = ${q.cardId}`;
    expect(h.state.regenerate).toEqual([
      { kind: "card", questionId: q.cardId, chunkId: chunk.c, ladderId: ladder.ladderId },
    ]);
    expect(await queue(d.cookie)).not.toContain(q.cardId);

    expect((await flag(d.cookie, { kind: "card", id: q.cardId })).status).toBe(200);
    expect(h.state.regenerate).toHaveLength(1);
    expect(await sql()`SELECT count(*)::int AS n FROM question_flags`).toEqual([{ n: 4 }]);
  });

  test("3 flaggers remove an MCQ: it leaves the pool for everyone; one mcq event", async () => {
    const ls = [await learner(), await learner(), await learner(), await learner()];
    const { ladder, pool } = await ladderFor(ls, 11);
    const q = pool[0] as { id: string };
    for (const l of ls.slice(0, 3)) await flag(l.cookie, { kind: "mcq", id: q.id });
    expect(await status("mcqs", q.id)).toBe("removed");
    expect(h.state.regenerate).toHaveLength(1);
    expect(h.state.regenerate[0]).toMatchObject({ kind: "mcq", questionId: q.id, ladderId: ladder.ladderId });
    const d = ls[3] as (typeof ls)[0];
    for (let i = 0; i < 5; i++) {
      await sql()`DELETE FROM mcq_attempts`;
      const ids = (await startAttempt(d.cookie, ladder.ladderId)).questions.map((x) => x.id);
      expect(ids).toHaveLength(10);
      expect(ids).not.toContain(q.id);
    }
  });

  test("two parallel flags at count 2 give one status change and one event", async () => {
    const ls = [await learner(), await learner(), await learner(), await learner()];
    const { pool } = await ladderFor(ls);
    const q = pool[0] as { id: string };
    await flag((ls[0] as (typeof ls)[0]).cookie, { kind: "mcq", id: q.id });
    await flag((ls[1] as (typeof ls)[0]).cookie, { kind: "mcq", id: q.id });
    const res = await Promise.all([
      flag((ls[2] as (typeof ls)[0]).cookie, { kind: "mcq", id: q.id }),
      flag((ls[3] as (typeof ls)[0]).cookie, { kind: "mcq", id: q.id }),
    ]);
    expect(res.map((r) => r.status)).toEqual([200, 200]);
    expect(await status("mcqs", q.id)).toBe("removed");
    expect(h.state.regenerate).toHaveLength(1);
  });

  test("a failing send rolls the flag back (status stays active, no flag row)", async () => {
    const ls = [await learner(), await learner(), await learner()];
    const { pool } = await ladderFor(ls);
    const q = pool[0] as { id: string };
    await flag((ls[0] as (typeof ls)[0]).cookie, { kind: "mcq", id: q.id });
    await flag((ls[1] as (typeof ls)[0]).cookie, { kind: "mcq", id: q.id });
    h.state.regenerateFails = true;
    try {
      expect((await flag((ls[2] as (typeof ls)[0]).cookie, { kind: "mcq", id: q.id })).status).toBe(503);
    } finally {
      h.state.regenerateFails = false;
    }
    expect(await status("mcqs", q.id)).toBe("active");
    expect(await sql()`SELECT count(*)::int AS n FROM question_flags`).toEqual([{ n: 2 }]);
    expect((await flag((ls[2] as (typeof ls)[0]).cookie, { kind: "mcq", id: q.id })).status).toBe(200);
    expect(h.state.regenerate).toHaveLength(1);
  });
});

describe("T016 a flag never changes scoring or evidence", () => {
  test("an open attempt holding Q still scores all 10 questions after Q is flagged and removed; no evidence row is written by flags", async () => {
    const ls = [await learner(), await learner(), await learner()];
    const { ladder, pool } = await ladderFor(ls, 10);
    const a = ls[0] as (typeof ls)[0];
    const attempt = await startAttempt(a.cookie, ladder.ladderId);
    expect(attempt.questions).toHaveLength(10);
    const q = attempt.questions[0] as { id: string };
    expect(pool.map((p) => p.id)).toContain(q.id);
    for (const l of ls) await flag(l.cookie, { kind: "mcq", id: q.id });
    expect(await status("mcqs", q.id)).toBe("removed");
    expect(await sql()`SELECT count(*)::int AS n FROM evidence_records`).toEqual([{ n: 0 }]);
    const answers = Object.fromEntries(
      attempt.questions.map((x) => [x.id, x.options.findIndex((o) => o.startsWith("key-"))]),
    );
    const res = await h.app.request(`${BASE}/api/mcq-attempts/${attempt.attemptId}/submit`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: a.cookie },
      body: JSON.stringify({ answers }),
    });
    expect(await res.json()).toMatchObject({ pass: true, correct: 10 });
  });
});
