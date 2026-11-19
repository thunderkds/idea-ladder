import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { SQL } from "bun";
import type { PassedLevels } from "../src/server/ladder-view.ts";
import { type McqAttempt, startMcqAttempt } from "../src/server/mcq-test.ts";
import { migrateUp } from "../src/server/migrate.ts";
import { createTestDatabase } from "./support/db.ts";
import { type SeededLadder, seedLadder, seedLearner, seedPool } from "./support/mcq-seed.ts";

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
  await db.sql`TRUNCATE mcq_attempts, ladders, repo_snapshots, users CASCADE`;
});

/** L0 is always open; L3 needs L0-L2 passed. */
const passedUpTo2: PassedLevels = async () => ["L0", "L1", "L2"];
const nothingPassed: PassedLevels = async () => [];

/** True when any object at any depth has a property named `key`. */
function hasKeyField(v: unknown): boolean {
  if (Array.isArray(v)) return v.some(hasKeyField);
  if (v && typeof v === "object") return Object.entries(v).some(([k, x]) => k === "key" || hasKeyField(x));
  return false;
}

async function setup(level = "L3", size = 17): Promise<{ learner: string; ladder: SeededLadder }> {
  const learner = await seedLearner(sql());
  const ladder = await seedLadder(sql());
  await seedPool(sql(), ladder, level, size);
  return { learner, ladder };
}
const attemptRows = async () => Number((await sql()`SELECT count(*)::int AS n FROM mcq_attempts`)[0].n);
const start = (learner: string, ladderId: string, level: string, now = T, passed = passedUpTo2) =>
  startMcqAttempt(sql(), learner, ladderId, level, now, passed);

describe("T012 startMcqAttempt", () => {
  test("SC 1: 10 of 17 distinct questions of this ladder + level, options shuffled, no key at any depth", async () => {
    const { learner, ladder } = await setup("L3", 17);
    await seedPool(sql(), ladder, "L0", 9); // another level's questions in the same table
    const other = await seedLadder(sql());
    await seedPool(sql(), other, "L3", 9); // another ladder's questions
    const result = await start(learner, ladder.ladderId, "L3");
    expect("attemptId" in result).toBe(true);
    const a = result as McqAttempt;
    expect(a.questions).toHaveLength(10);
    expect(new Set(a.questions.map((q) => q.id)).size).toBe(10);
    const pool = await sql()`SELECT id::text AS id FROM mcqs WHERE ladder_id = ${ladder.ladderId} AND level = 'L3'`;
    const poolIds = new Set(pool.map((r: { id: string }) => r.id));
    for (const q of a.questions) {
      expect(poolIds.has(q.id)).toBe(true);
      expect(q.options).toHaveLength(4);
      expect(q.question).toMatch(/^Question L3 /);
    }
    expect(hasKeyField(JSON.parse(JSON.stringify(result)))).toBe(false);
    const [row] = await sql()`SELECT questions, started_at FROM mcq_attempts WHERE id = ${a.attemptId}`;
    expect(row.questions.map((q: { id: string }) => q.id)).toEqual(a.questions.map((q) => q.id));
    expect(new Date(row.started_at).toISOString()).toBe(T.toISOString());
    expect(a.expiresAt).toBe(at(30 * MIN).toISOString());
  });

  test("option order is stored and is a permutation; over many draws it is not always the stored order", async () => {
    const { learner, ladder } = await setup("L3", 17);
    const orders = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const a = (await start(learner, ladder.ladderId, "L3", at(i * 25 * HOUR))) as McqAttempt;
      const [row] = await sql()`SELECT questions FROM mcq_attempts WHERE id = ${a.attemptId}`;
      for (const q of row.questions as { order: number[] }[]) {
        expect([...q.order].sort()).toEqual([0, 1, 2, 3]);
        orders.add(q.order.join(""));
      }
    }
    expect(orders.size).toBeGreaterThan(1);
  });

  test("SC 7: a pool of 7 -> pool-too-small and no attempt row; a pool of 9 -> 9 questions", async () => {
    const small = await setup("L3", 7);
    expect(await start(small.learner, small.ladder.ladderId, "L3")).toEqual({ status: 422, error: "pool-too-small" });
    expect(await attemptRows()).toBe(0);
    const nine = await setup("L3", 9);
    const a = (await start(nine.learner, nine.ladder.ladderId, "L3")) as McqAttempt;
    expect(a.questions).toHaveLength(9);
  });

  test("SC 5: the 4th start within 24 h -> 429 with retryAt; abandoned attempts count; it opens again after 24 h", async () => {
    const { learner, ladder } = await setup("L3", 17);
    for (const t of [0, 1 * HOUR, 2 * HOUR])
      expect("attemptId" in (await start(learner, ladder.ladderId, "L3", at(t)))).toBe(true);
    expect(await start(learner, ladder.ladderId, "L3", at(3 * HOUR))).toEqual({
      status: 429,
      error: "too-many-attempts",
      retryAt: at(24 * HOUR).toISOString(),
    });
    expect(await attemptRows()).toBe(3);
    expect("attemptId" in (await start(learner, ladder.ladderId, "L3", at(24 * HOUR + 1)))).toBe(true);
    // Another learner and another level have their own limits.
    const other = await seedLearner(sql());
    expect("attemptId" in (await start(other, ladder.ladderId, "L3", at(3 * HOUR)))).toBe(true);
  });

  test("a retake avoids the previous attempt's questions when the pool holds >= 2 x asked", async () => {
    const { learner, ladder } = await setup("L3", 20);
    const first = (await start(learner, ladder.ladderId, "L3", at(0))) as McqAttempt;
    const second = (await start(learner, ladder.ladderId, "L3", at(HOUR))) as McqAttempt;
    const firstIds = new Set(first.questions.map((q) => q.id));
    expect(second.questions.filter((q) => firstIds.has(q.id))).toEqual([]);
  });

  test("SC 7 / AC 7: a locked level, an unknown ladder or a bad level -> 404, no attempt", async () => {
    const { learner, ladder } = await setup("L3", 17);
    expect(await start(learner, ladder.ladderId, "L3", T, nothingPassed)).toEqual({ status: 404, error: "not-found" });
    expect(await start(learner, "999999", "L3")).toEqual({ status: 404, error: "not-found" });
    expect(await start(learner, "abc", "L3")).toEqual({ status: 404, error: "not-found" });
    expect(await start(learner, ladder.ladderId, "L9")).toEqual({ status: 404, error: "not-found" });
    expect(await attemptRows()).toBe(0);
  });
});

describe("T012 startMcqAttempt parallel starts", () => {
  test("AC 6: four parallel starts of one learner + level create 3 attempts and 1 is 429 with retryAt", async () => {
    const { learner, ladder } = await setup("L3", 17);
    const results = await Promise.all([0, 1, 2, 3].map(() => start(learner, ladder.ladderId, "L3", T)));
    expect(results.filter((r) => "attemptId" in r)).toHaveLength(3);
    const limited = results.filter((r) => "error" in r);
    expect(limited).toEqual([{ status: 429, error: "too-many-attempts", retryAt: at(24 * HOUR).toISOString() }]);
    const [{ n }] = await sql()`
      SELECT count(*)::int AS n FROM mcq_attempts WHERE learner_id = ${learner} AND level = 'L3'`;
    expect(n).toBe(3);
  });
});
