// T016: the consumer of ladder/question.regenerate. Scripted models, test database.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { InngestTestEngine } from "@inngest/test";
import { REGENERATE_EVENT, type RegenerateRequested } from "../src/server/flags.ts";
import { createInngest } from "../src/server/ladder-generate.ts";
import { migrateUp } from "../src/server/migrate.ts";
import type { Generate, ModelADeps } from "../src/server/model-a.ts";
import { questionRegenerateFunction, regenerateQuestion } from "../src/server/question-regenerate.ts";
import { createTestDatabase } from "./support/db.ts";
import { seedLadder, seedPool } from "./support/mcq-seed.ts";

let db: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => {
  db = await createTestDatabase();
  await migrateUp(db.sql);
});
afterAll(async () => {
  await db.drop();
});
beforeEach(async () => {
  await db.sql`TRUNCATE ladders, repo_snapshots CASCADE`;
});

const usage = { model: "mock", inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 };
const TEXT = "The retry delay doubles after every failed attempt until it reaches the cap.";
const GOOD = {
  question: "What happens to the retry delay after a failed attempt?",
  options: ["doubles", "halves", "stays the same", "resets to zero"],
  key: "doubles",
};

/** Model A returns `mcq` (with the chunk id of the call's data); counts calls. */
function modelA(mcq: typeof GOOD & { key: string }, chunkId: () => number) {
  const calls = { n: 0 };
  const generate: Generate = async ({ schema }) => {
    calls.n++;
    return { value: schema.parse({ mcq: { ...mcq, chunkId: chunkId() } }), usage };
  };
  return { deps: { backend: "api", generate } as ModelADeps, calls };
}
/** Model B picks the option equal to `pick` (or the first option that is not the key when `pick` is undefined). */
function modelB(pick: string | undefined) {
  const generate: Generate = async ({ schema, prompt }) => {
    const d = JSON.parse(prompt.split("\n")[1] as string) as { options: string[] };
    const i = pick === undefined ? d.options.findIndex((o) => o !== GOOD.key) : d.options.indexOf(pick);
    return { value: schema.parse({ answerIndex: i }), usage };
  };
  return { backend: "api", generate } as ModelADeps;
}

/** A removed L3 MCQ with its chunk text set to TEXT, plus 3 active ones. */
async function seed() {
  const ladder = await seedLadder(db.sql);
  const pool = await seedPool(db.sql, ladder, "L3", 4);
  const [removed] = pool as [(typeof pool)[0]];
  const [m] = await db.sql`UPDATE mcqs SET status = 'removed' WHERE id = ${removed.id} RETURNING chunk_id::text AS c`;
  await db.sql`UPDATE chunks SET text = ${TEXT} WHERE id = ${m.c}`;
  const ev: RegenerateRequested = { kind: "mcq", questionId: removed.id, chunkId: m.c, ladderId: ladder.ladderId };
  return { ev, chunkId: Number(m.c) };
}
const count = async () => (await db.sql`SELECT count(*)::int AS n FROM mcqs`)[0].n as number;

describe("T016 regenerate consumer", () => {
  test("an MCQ event: the replacement passes every check and is inserted as a new active row; the removed row stays removed", async () => {
    const { ev, chunkId } = await seed();
    const a = modelA(GOOD, () => chunkId);
    const out = await regenerateQuestion({ sql: db.sql, modelA: a.deps, modelB: modelB("doubles") }, ev);
    expect(out.status).toBe("inserted");
    expect(await count()).toBe(5);
    const [row] =
      await db.sql`SELECT status, level, key, chunk_id::text AS c, question FROM mcqs ORDER BY id DESC LIMIT 1`;
    expect(row).toMatchObject({
      status: "active",
      level: "L3",
      key: "doubles",
      c: ev.chunkId,
      question: GOOD.question,
    });
    expect((await db.sql`SELECT status FROM mcqs WHERE id = ${ev.questionId}`)[0].status).toBe("removed");
  });

  test("blind solver disagrees on every try: no row inserted, the question stays removed", async () => {
    const { ev, chunkId } = await seed();
    const a = modelA(GOOD, () => chunkId);
    const out = await regenerateQuestion({ sql: db.sql, modelA: a.deps, modelB: modelB(undefined) }, ev);
    expect(out).toEqual({ status: "kept-removed", reason: "blind-solve-mismatch" });
    expect(a.calls.n).toBe(3);
    expect(await count()).toBe(4);
  });

  test("a key that is not in the chunk, a bad citation, and a duplicate question all fail the checks: nothing inserted", async () => {
    const { ev, chunkId } = await seed();
    const badKey = modelA(
      { ...GOOD, options: ["triples", "halves", "stays", "resets"], key: "triples" },
      () => chunkId,
    );
    expect(await regenerateQuestion({ sql: db.sql, modelA: badKey.deps, modelB: modelB("triples") }, ev)).toEqual({
      status: "kept-removed",
      reason: "key-check-failed",
    });
    const badChunk = modelA(GOOD, () => 999_999);
    expect(
      (await regenerateQuestion({ sql: db.sql, modelA: badChunk.deps, modelB: modelB("doubles") }, ev)).status,
    ).toBe("kept-removed");
    const [live] = await db.sql`SELECT question FROM mcqs WHERE status = 'active' LIMIT 1`;
    const dup = modelA({ ...GOOD, question: live.question }, () => chunkId);
    expect(await regenerateQuestion({ sql: db.sql, modelA: dup.deps, modelB: modelB("doubles") }, ev)).toEqual({
      status: "kept-removed",
      reason: "duplicate",
    });
    expect(await count()).toBe(4);
  });

  test("a card event is a no-op with a reason; an active question is skipped", async () => {
    const { ev, chunkId } = await seed();
    const a = modelA(GOOD, () => chunkId);
    const deps = { sql: db.sql, modelA: a.deps, modelB: modelB("doubles") };
    expect(await regenerateQuestion(deps, { ...ev, kind: "card" })).toEqual({
      status: "skipped",
      reason: "card-no-regenerator",
    });
    await db.sql`UPDATE mcqs SET status = 'active' WHERE id = ${ev.questionId}`;
    expect(await regenerateQuestion(deps, ev)).toEqual({ status: "skipped", reason: "not-removed" });
    expect(a.calls.n).toBe(0);
    expect(await count()).toBe(4);
  });

  test("the Inngest function runs the event through the test engine", async () => {
    const { ev, chunkId } = await seed();
    const a = modelA(GOOD, () => chunkId);
    const fn = questionRegenerateFunction(createInngest(), {
      sql: db.sql,
      modelA: a.deps,
      modelB: modelB("doubles"),
    });
    const { result } = await new InngestTestEngine({
      function: fn,
      events: [{ name: REGENERATE_EVENT, data: ev }],
    }).execute();
    expect(result).toMatchObject({ status: "inserted" });
    expect(await count()).toBe(5);
  });
});
