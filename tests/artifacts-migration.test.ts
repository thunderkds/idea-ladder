// T013: migration 0014_artifacts — the verified-artifact table (L2 branch, L4 repo or PR) and the L1 run feedback.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { migrateDown, migrateUp } from "../src/server/migrate.ts";
import { createTestDatabase } from "./support/db.ts";
import { seedLadder, seedLearner } from "./support/mcq-seed.ts";

const ALLOW_DOWN = { MIGRATE_ALLOW_DOWN: "1", NODE_ENV: "test" };
const SHA = "b".repeat(40);

let db: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => {
  db = await createTestDatabase();
  await migrateUp(db.sql);
});
afterAll(async () => {
  await db.drop();
});

const insert = (learner: string, ladder: string, row: Record<string, unknown> = {}) => {
  const r = { level: "L2", kind: "branch", url: "https://github.com/a/b/tree/x", sha: SHA, ...row };
  return db.sql`
    INSERT INTO artifacts (learner_id, ladder_id, level, kind, url, repo_full_name, head_sha, verified_at)
    VALUES (${learner}, ${ladder}, ${r.level}, ${r.kind}, ${r.url}, 'a/b', ${r.sha}, now())`;
};
const rejects = async (p: PromiseLike<unknown>, re: RegExp) =>
  await expect((async () => await p)()).rejects.toThrow(re);

describe("T013 migration 0014_artifacts", () => {
  test("an artifact row needs a 40-hex head SHA, L2 = branch, L4 = repo or pr; one row per learner+ladder+level+url+sha", async () => {
    const learner = await seedLearner(db.sql);
    const { ladderId } = await seedLadder(db.sql);
    await insert(learner, ladderId);
    await rejects(insert(learner, ladderId), /duplicate|unique/i);
    await insert(learner, ladderId, { sha: "c".repeat(40) }); // a new head of the same branch is a new proof
    await insert(learner, ladderId, { level: "L4", kind: "pr", url: "https://github.com/a/b/pull/1" });
    await rejects(insert(learner, ladderId, { sha: "B".repeat(40), url: "u2" }), /check/i);
    await rejects(insert(learner, ladderId, { level: "L2", kind: "pr", url: "u3" }), /check/i);
    await rejects(insert(learner, ladderId, { level: "L4", kind: "branch", url: "u4" }), /check/i);
    await rejects(insert(learner, ladderId, { level: "L1", kind: "repo", url: "u5" }), /check/i);
    expect((await db.sql`SELECT count(*)::int AS n FROM artifacts`)[0].n).toBe(3);
  });

  test("run_feedback keeps one row per learner + ladder, explanation at most 600 characters", async () => {
    const learner = await seedLearner(db.sql);
    const { ladderId } = await seedLadder(db.sql);
    const put = (explanation: string) => db.sql`
      INSERT INTO run_feedback (learner_id, ladder_id, run_log, explanation, updated_at)
      VALUES (${learner}, ${ladderId}, '', ${explanation}, now())`;
    await put("A. B. C.");
    await rejects(put("A. B. C."), /duplicate|unique/i);
    await rejects(put("x".repeat(601)), /check|duplicate/i);
  });

  test("down drops both tables and nothing else; up again restores them", async () => {
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0014_artifacts");
    const left = await db.sql`SELECT to_regclass('public.artifacts') AS a, to_regclass('public.run_feedback') AS r,
      to_regclass('public.evidence_records') AS e`;
    expect(left).toEqual([{ a: null, r: null, e: "evidence_records" }]);
    expect(await migrateUp(db.sql)).toEqual(["0014_artifacts"]);
  });
});
