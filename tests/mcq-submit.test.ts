import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { SQL } from "bun";
import pkg from "../package.json" with { type: "json" };
import { type EvidenceRecord, evidencePassedLevels, hashRecord } from "../src/server/evidence.ts";
import type { PassedLevels } from "../src/server/ladder-view.ts";
import { type McqAttempt, type McqResult, startMcqAttempt, submitMcqAttempt } from "../src/server/mcq-test.ts";
import { migrateUp } from "../src/server/migrate.ts";
import { rateCard } from "../src/server/review.ts";
import { createTestDatabase } from "./support/db.ts";
import { type SeededLadder, type SeededMcq, seedLadder, seedLearner, seedPool } from "./support/mcq-seed.ts";

const T = new Date("2026-11-01T09:00:00Z");
const at = (ms: number) => new Date(T.getTime() + ms);
const MIN = 60_000;
const HOUR = 60 * MIN;

let db: Awaited<ReturnType<typeof createTestDatabase>>;
const sql = (): SQL => db.sql;
beforeAll(async () => {
  db = await createTestDatabase();
  await migrateUp(db.sql);
});
afterAll(async () => {
  await db.drop();
});
beforeEach(async () => {
  await db.sql`TRUNCATE mcq_attempts, evidence_records, ladders, repo_snapshots, users CASCADE`;
});

const passedUpTo2: PassedLevels = async () => ["L0", "L1", "L2"];

type Setup = { learner: string; ladder: SeededLadder; pool: SeededMcq[] };
async function setup(size = 17, login = "thunderkds"): Promise<Setup> {
  const learner = await seedLearner(sql(), login);
  const ladder = await seedLadder(sql());
  const pool = await seedPool(sql(), ladder, "L3", size);
  return { learner, ladder, pool };
}
async function begin(s: Setup, now = T): Promise<McqAttempt> {
  return (await startMcqAttempt(sql(), s.learner, s.ladder.ladderId, "L3", now, passedUpTo2)) as McqAttempt;
}
/** The first `nCorrect` questions answered with the key, the rest with a wrong option (indexes in shown order). */
function answers(a: McqAttempt, nCorrect: number): Record<string, number> {
  return Object.fromEntries(
    a.questions.map((q, i) => [q.id, q.options.findIndex((o) => o.startsWith(i < nCorrect ? "key-" : "w1-"))]),
  );
}
const submit = (s: Setup, attemptId: string, body: unknown, now = at(5 * MIN)) =>
  submitMcqAttempt(sql(), s.learner, attemptId, body, now);
const evidenceRows = async () => Number((await sql()`SELECT count(*)::int AS n FROM evidence_records`)[0].n);
const attemptRow = async (id: string) =>
  (await sql()`SELECT submitted_at, correct, passed FROM mcq_attempts WHERE id = ${id}`)[0];

describe("T012 submitMcqAttempt scoring", () => {
  test("SC 2: 8 of 10 correct passes, writes 1 evidence record and unlocks L4", async () => {
    const s = await setup();
    const a = await begin(s);
    const r = (await submit(s, a.attemptId, answers(a, 8))) as McqResult;
    expect(r).toMatchObject({ asked: 10, correct: 8, pass: true, unlockedLevel: "L4", reviewCardIds: [] });
    expect(await evidenceRows()).toBe(1);
    const passed = await evidencePassedLevels(sql())(s.ladder.ladderId, s.learner);
    expect(passed).toEqual(["L3"]);
    expect(await attemptRow(a.attemptId)).toMatchObject({ correct: 8, passed: true });
  });

  test("SC 2: 7 of 10 fails: no record, nothing unlocked, the review cards of the 3 missed questions", async () => {
    const s = await setup();
    const a = await begin(s);
    const r = (await submit(s, a.attemptId, answers(a, 7))) as McqResult;
    expect(r).toMatchObject({ asked: 10, correct: 7, pass: false, unlockedLevel: null, evidence: null });
    const missed = new Set(a.questions.slice(7).map((q) => q.id));
    const expected = s.pool.filter((m) => missed.has(m.id)).map((m) => m.cardId);
    expect([...r.reviewCardIds].sort()).toEqual([...expected].sort());
    // T032: these are review_cards ids, so rateCard accepts each one
    await sql()`INSERT INTO generation_jobs (repo_full_name, commit_sha, status, started_by)
      VALUES (${s.ladder.repo}, ${s.ladder.sha}, 'done', ${s.learner})`;
    for (const [i, cardId] of r.reviewCardIds.entries())
      expect(
        await rateCard(
          sql(),
          s.learner,
          { cardId, rating: "again", idempotencyKey: `k${i}`, elapsedMs: 1 },
          at(10 * MIN),
          passedUpTo2,
        ),
      ).toBeDefined();
    expect(await evidenceRows()).toBe(0);
    expect(await evidencePassedLevels(sql())(s.ladder.ladderId, s.learner)).toEqual([]);
  });

  test("SC 7: a pool of 9 asks 9; 8 correct passes, 7 fails; a pool of 8: 7 correct passes", async () => {
    const nine = await setup(9);
    const a1 = await begin(nine);
    expect(a1.questions).toHaveLength(9);
    expect(((await submit(nine, a1.attemptId, answers(a1, 7))) as McqResult).pass).toBe(false);
    const a2 = await begin(nine, at(HOUR));
    expect(((await submit(nine, a2.attemptId, answers(a2, 8), at(HOUR + MIN))) as McqResult).pass).toBe(true);
    const eight = await setup(8, "other");
    const a3 = await begin(eight);
    expect(((await submit(eight, a3.attemptId, answers(a3, 7))) as McqResult).pass).toBe(true);
  });

  test("unanswered questions count as wrong", async () => {
    const s = await setup();
    const a = await begin(s);
    const partial = Object.fromEntries(Object.entries(answers(a, 10)).slice(0, 7));
    expect(((await submit(s, a.attemptId, partial)) as McqResult).correct).toBe(7);
  });
});

describe("T012 evidence record", () => {
  test("AC 4 / AC 5: shaped like the source example; the stored hash recomputes", async () => {
    const s = await setup(17, "thunderkds");
    const a = await begin(s);
    const r = (await submit(s, a.attemptId, answers(a, 9), at(5 * MIN))) as McqResult;
    const [row] = await sql()`SELECT record FROM evidence_records`;
    const stored = row.record as EvidenceRecord;
    expect(stored).toEqual(r.evidence as EvidenceRecord);
    expect(stored).toEqual({
      learner: "github:thunderkds",
      ladder: `repo:${s.ladder.repo}@3f2a9c1`,
      level: "L3",
      test: "mcq",
      evidence: { asked: 10, correct: 9, pass: 8, questionIds: a.questions.map((q) => q.id) },
      verifiedBy: `verifier@${pkg.version}`,
      verifiedAt: at(5 * MIN).toISOString(),
      hash: stored.hash,
    });
    expect(stored.verifiedAt).toMatch(/Z$/);
    expect(hashRecord(stored)).toBe(stored.hash as string);
  });

  test("a second pass of the same level writes no second record and returns the first", async () => {
    const s = await setup();
    const a1 = await begin(s);
    const first = (await submit(s, a1.attemptId, answers(a1, 10))) as McqResult;
    const a2 = await begin(s, at(HOUR));
    const second = (await submit(s, a2.attemptId, answers(a2, 10), at(HOUR + MIN))) as McqResult;
    expect(second.pass).toBe(true);
    expect(second.evidence).toEqual(first.evidence);
    expect(await evidenceRows()).toBe(1);
  });

  test("two concurrent passes of one level (two attempts) keep one record", async () => {
    const s = await setup(20);
    const a1 = await begin(s);
    const a2 = await begin(s, at(MIN));
    const [r1, r2] = (await Promise.all([
      submit(s, a1.attemptId, answers(a1, 10)),
      submit(s, a2.attemptId, answers(a2, 10)),
    ])) as McqResult[];
    expect(r1?.pass && r2?.pass).toBe(true);
    expect(r1?.evidence).toEqual(r2?.evidence as EvidenceRecord);
    expect(await evidenceRows()).toBe(1);
  });
});

describe("T012 submitMcqAttempt rejections leave the attempt and evidence unchanged", () => {
  test("SC 6: submit after 30 min, a second submit, an answer for a foreign question id", async () => {
    const s = await setup();
    const late = await begin(s);
    expect(await submit(s, late.attemptId, answers(late, 10), at(31 * MIN))).toEqual({
      status: 409,
      error: "attempt-expired",
    });
    expect(await attemptRow(late.attemptId)).toMatchObject({ submitted_at: null, correct: null });

    const a = await begin(s, at(HOUR));
    const foreign = { ...answers(a, 10), [s.pool.find((m) => !a.questions.some((q) => q.id === m.id))?.id ?? "1"]: 0 };
    expect(await submit(s, a.attemptId, foreign, at(HOUR + MIN))).toEqual({ status: 422, error: "unknown-question" });
    expect(await attemptRow(a.attemptId)).toMatchObject({ submitted_at: null });

    const ok = (await submit(s, a.attemptId, answers(a, 7), at(HOUR + MIN))) as McqResult;
    expect(ok.pass).toBe(false);
    const before = await attemptRow(a.attemptId);
    expect(await submit(s, a.attemptId, answers(a, 10), at(HOUR + 2 * MIN))).toEqual({
      status: 409,
      error: "already-submitted",
    });
    expect(await attemptRow(a.attemptId)).toEqual(before);
    expect(await evidenceRows()).toBe(0);
  });

  test("option text instead of an index, an index out of range, or a non-object body -> 400", async () => {
    const s = await setup();
    const a = await begin(s);
    const q = a.questions[0] as { id: string; options: string[] };
    for (const body of [{ [q.id]: q.options[0] }, { [q.id]: 4 }, { [q.id]: -1 }, { [q.id]: 1.5 }, [1], null, "x"])
      expect(await submit(s, a.attemptId, body)).toEqual({ status: 400, error: "invalid-request" });
    expect(await attemptRow(a.attemptId)).toMatchObject({ submitted_at: null });
  });

  test("two concurrent submits of one attempt: exactly one is scored", async () => {
    const s = await setup();
    const a = await begin(s);
    const results = await Promise.all([submit(s, a.attemptId, answers(a, 10)), submit(s, a.attemptId, answers(a, 10))]);
    expect(results.filter((r) => "pass" in r)).toHaveLength(1);
    expect(results.filter((r) => "error" in r)).toEqual([{ status: 409, error: "already-submitted" }]);
    expect(await evidenceRows()).toBe(1);
  });

  test("AC 7: another learner's attempt id or an unknown id -> 404", async () => {
    const s = await setup();
    const a = await begin(s);
    const other = await seedLearner(sql(), "someone-else");
    expect(await submitMcqAttempt(sql(), other, a.attemptId, answers(a, 10), at(MIN))).toEqual({
      status: 404,
      error: "not-found",
    });
    expect(await submit(s, "999999", {})).toEqual({ status: 404, error: "not-found" });
    expect(await submit(s, "abc", {})).toEqual({ status: 404, error: "not-found" });
    expect(await attemptRow(a.attemptId)).toMatchObject({ submitted_at: null });
  });
});
