// T032: cards saved by saveLadder are rows of review_cards, so the review queue serves them and rateCard accepts them.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { GeneratedLevel } from "../src/server/check-and-dedupe.ts";
import { noPasses } from "../src/server/ladder-view.ts";
import { migrateUp } from "../src/server/migrate.ts";
import { rateCard, reviewQueue } from "../src/server/review.ts";
import { saveLadder } from "../src/server/save-ladder.ts";
import { createTestDatabase } from "./support/db.ts";
import { V0_REPOS } from "./support/github-fixtures.ts";

const REPO = "developit/mitt";
const SHA: string = V0_REPOS[REPO];
const NOW = new Date("2026-11-19T09:00:00Z");

let db: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => {
  db = await createTestDatabase();
  await migrateUp(db.sql);
});
afterAll(async () => {
  await db.drop();
});
beforeEach(async () => {
  await db.sql`TRUNCATE generation_jobs, repo_snapshots, ladders, users CASCADE`;
});

const level = (l: GeneratedLevel["level"], chunkId: number, n: number): GeneratedLevel => ({
  level: l,
  status: "generated",
  goal: `goal ${l}`,
  passTest: { kind: `kind-${l}`, description: `desc ${l}` },
  cards: Array.from({ length: n }, (_, i) => ({ front: `front ${l} ${i}`, back: `back ${l} ${i}`, chunkId })),
  mcqs: [],
  dropped: [],
});

async function saveForLearner() {
  const [{ id: userId }] =
    await db.sql`INSERT INTO users (github_id, github_login) VALUES (42, 'learner') RETURNING id::text AS id`;
  await db.sql`INSERT INTO repo_snapshots (repo_full_name, commit_sha, default_branch, archived, readme, topics, languages, dep_files, open_issues, good_first_issues, tree, tree_truncated)
    VALUES (${REPO}, ${SHA}, 'main', false, 'r', '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, 0, 0, '[]'::jsonb, false)`;
  const [{ id: chunkId }] =
    await db.sql`INSERT INTO chunks (repo_full_name, commit_sha, source, path, ordinal, start_line, end_line, text)
    VALUES (${REPO}, ${SHA}, 'core', 'src/index.ts', 0, 1, 2, 't') RETURNING id::int AS id`;
  const [{ id: jobId }] =
    await db.sql`INSERT INTO generation_jobs (repo_full_name, commit_sha, status, started_by) VALUES (${REPO}, ${SHA}, 'mapped', ${userId}) RETURNING id::text AS id`;
  const levels = [level("L0", chunkId, 2), level("L1", chunkId, 1)];
  const saved = await saveLadder(db.sql, { jobId, repo: REPO, sha: SHA, levels, costByStep: null });
  return { userId, ladderId: saved.ladderId };
}

describe("T032 generated cards reach the review queue", () => {
  test("AC 1: the review queue returns the saved ladder's L0 cards for a learner with L0 open", async () => {
    const { userId, ladderId } = await saveForLearner();
    const queue = await reviewQueue(db.sql, userId, NOW, noPasses);
    expect(queue.cards.map((c) => [c.ladderId, c.level, c.front])).toEqual([
      [ladderId, "L0", "front L0 0"],
      [ladderId, "L0", "front L0 1"],
    ]);
  });

  test("a saved card id is accepted by rateCard", async () => {
    const { userId } = await saveForLearner();
    const [first] = (await reviewQueue(db.sql, userId, NOW, noPasses)).cards;
    expect(first).toBeDefined();
    const res = await rateCard(
      db.sql,
      userId,
      { cardId: first?.cardId ?? "0", rating: "good", idempotencyKey: "k1", elapsedMs: 1000 },
      NOW,
      noPasses,
    );
    expect(res).toBeDefined();
  });
});
