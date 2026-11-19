// T013 AC 6 (option B, Debate 2026-11-19): L1 passes through the T012 MCQ pass test on the README + docs chunks.
// A run log and a 3-sentence explanation are optional feedback only (checkRunFeedback).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { GeneratedLevel, LadderLevel } from "../src/server/check-and-dedupe.ts";
import { evidencePassedLevels, hashRecord, writeEvidenceRecord } from "../src/server/evidence.ts";
import { generateLevel, type LevelChunk, MCQ_LEVELS, PASS_TEST_KIND } from "../src/server/level-generator.ts";
import { startMcqAttempt, submitMcqAttempt } from "../src/server/mcq-test.ts";
import { migrateUp } from "../src/server/migrate.ts";
import type { Generate, GenerateInput } from "../src/server/model-a.ts";
import { checkRunFeedback } from "../src/server/run-feedback.ts";
import { buildReport, POOL_LEVELS, saveLadder } from "../src/server/save-ladder.ts";
import { FIXED_LEVELS } from "../src/shared/levels.ts";
import { createTestDatabase } from "./support/db.ts";
import { seedLearner } from "./support/mcq-seed.ts";

let db: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => {
  db = await createTestDatabase();
  await migrateUp(db.sql);
});
afterAll(async () => {
  await db.drop();
});

const USAGE = { model: "test-model", inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 };
const README = "Run `bun install`, then `bun run dev`. The server listens on port 3000. Set DATABASE_URL first.";

/** One scripted model A answer for L1 with `n` MCQs on the README chunk; records the inputs. */
function l1Model(n: number, chunkId: number) {
  const inputs: GenerateInput<unknown>[] = [];
  const generate: Generate = async (input) => {
    inputs.push(input as GenerateInput<unknown>);
    const mcqs = Array.from({ length: n }, (_, i) => ({
      question: `Setup question ${i}?`,
      options: ["port 3000", `wrong a${i}`, `wrong b${i}`, `wrong c${i}`],
      key: "port 3000",
      chunkId,
    }));
    const cards = Array.from({ length: 5 }, (_, i) => ({ front: `f${i}`, back: `b${i}`, chunkId }));
    const value = { goal: "Run it", passTest: { kind: "x", description: "MCQs on running it" }, cards, mcqs };
    return { value: input.schema.parse(value), usage: USAGE };
  };
  return { generate, inputs };
}

describe("T013 L1 run-mcq kind and pools (AC 6)", () => {
  test("L1 kind is run-mcq in both places, with the option B description", () => {
    expect(PASS_TEST_KIND.L1).toBe("run-mcq");
    expect(FIXED_LEVELS.L1.passTest).toEqual({
      kind: "run-mcq",
      description: "MCQs on setting up and running it; a run log and a 3-sentence explanation are optional feedback",
    });
    expect([...MCQ_LEVELS].sort()).toEqual(["L0", "L1", "L3"]);
    expect([...POOL_LEVELS].sort()).toEqual(["L0", "L1", "L3"]);
  });

  test("the L1 generator asks for an MCQ pool on installing, starting, configuring and what running shows", async () => {
    const chunk: LevelChunk = { id: 7, source: "readme", path: "README.md", startLine: 1, endLine: 1, text: README };
    const { generate, inputs } = l1Model(10, 7);
    const out = await generateLevel({ level: "L1", chunks: [chunk], generate });
    expect(out.passTest.kind).toBe("run-mcq");
    expect(out.mcqs).toHaveLength(10);
    const system = inputs[0]?.system ?? "";
    expect(system).toContain("multiple-choice questions");
    expect(system).toMatch(/install/);
    expect(system).toMatch(/port/);
    expect(system).toMatch(/environment variable/);
  });

  test("an L1 pool below 8 MCQs is flagged insufficient-pool", () => {
    const level = (n: number): GeneratedLevel => ({
      level: "L1",
      status: "generated",
      goal: "g",
      passTest: { kind: "run-mcq", description: "d" },
      cards: Array.from({ length: 5 }, (_, i) => ({ front: `f${i}`, back: "b", chunkId: 1 })),
      mcqs: Array.from({ length: n }, (_, i) => ({
        question: `q${i}`,
        options: ["a", "b", "c", "d"],
        key: "a",
        chunkId: 1,
      })),
      dropped: [],
    });
    expect(buildReport([level(7)], null).levels[0]?.flags).toEqual(["insufficient-pool"]);
    expect(buildReport([level(8)], null).levels[0]?.flags).toEqual([]);
  });
});

describe("T013 L1 passes through the T012 MCQ pass test (AC 6, Success Criterion 6)", () => {
  /** Saves a ladder whose L1 level is generated with `n` MCQs; returns the ladder id. */
  async function ladderWithL1Pool(n: number): Promise<{ ladderId: string; flags: string[] }> {
    const repo = `owner/run-${n}-${Date.now()}`;
    const sha = "a".repeat(40);
    await db.sql`INSERT INTO repo_snapshots (repo_full_name, commit_sha, default_branch, archived, readme, topics, languages, dep_files, open_issues, good_first_issues, tree, tree_truncated)
      VALUES (${repo}, ${sha}, 'main', false, ${README}, '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, 0, 0, '[]'::jsonb, false)`;
    const [c] = await db.sql`
      INSERT INTO chunks (repo_full_name, commit_sha, source, path, ordinal, start_line, end_line, text)
      VALUES (${repo}, ${sha}, 'readme', 'README.md', 0, 1, 1, ${README}) RETURNING id::int AS id`;
    const chunk: LevelChunk = { id: c.id, source: "readme", path: "README.md", startLine: 1, endLine: 1, text: README };
    const out = await generateLevel({ level: "L1", chunks: [chunk], generate: l1Model(n, c.id).generate });
    const l1: LadderLevel = { level: "L1", status: "generated", ...out };
    const skipped = (level: "L0" | "L2" | "L3" | "L4"): LadderLevel => ({
      level,
      status: "skipped",
      kind: "concept-only-skipped",
    });
    const [job] = await db.sql`
      INSERT INTO generation_jobs (repo_full_name, commit_sha, status) VALUES (${repo}, ${sha}, 'mapped') RETURNING id::text`;
    const levels = [skipped("L0"), l1, skipped("L2"), skipped("L3"), skipped("L4")];
    const { ladderId } = await saveLadder(db.sql, { jobId: job.id, repo, sha, levels, costByStep: null });
    const [row] = await db.sql`SELECT flags FROM ladder_levels WHERE ladder_id = ${ladderId} AND level = 'L1'`;
    return { ladderId, flags: row.flags };
  }

  test("a README with 10 L1 MCQs: pool saved, 8 of 10 correct passes, evidence test mcq, L2 opens", async () => {
    const learner = await seedLearner(db.sql);
    const { ladderId, flags } = await ladderWithL1Pool(10);
    expect(flags).toEqual([]);
    const passed = evidencePassedLevels(db.sql);
    // L0 is passed first (its own T012 test), so L1 is the open level.
    await db.sql.begin(async (tx) => {
      await writeEvidenceRecord(tx, learner, ladderId, {
        learner: "github:x",
        ladder: "repo:x",
        level: "L0",
        test: "mcq",
        evidence: {},
        verifiedBy: "test",
        verifiedAt: new Date().toISOString(),
      });
    });
    const now = new Date();
    const attempt = await startMcqAttempt(db.sql, learner, ladderId, "L1", now, passed);
    if ("status" in attempt) throw new Error(`start failed: ${attempt.error}`);
    expect(attempt.questions).toHaveLength(10);
    const answers: Record<string, number> = {};
    for (const [i, q] of attempt.questions.entries()) {
      const keyIndex = q.options.indexOf("port 3000");
      answers[q.id] = i < 8 ? keyIndex : (keyIndex + 1) % 4;
    }
    const result = await submitMcqAttempt(db.sql, learner, attempt.attemptId, answers, now);
    if ("status" in result) throw new Error(`submit failed: ${result.error}`);
    expect(result).toMatchObject({ asked: 10, correct: 8, pass: true, unlockedLevel: "L2" });
    expect(result.evidence).toMatchObject({ level: "L1", test: "mcq" });
    expect(result.evidence?.hash).toBe(hashRecord(result.evidence as NonNullable<typeof result.evidence>));
    expect(await passed(ladderId, learner)).toEqual(["L0", "L1"]);
  });

  test("a thin README (3 MCQs): L1 flagged insufficient-pool; an attempt answers pool-too-small", async () => {
    const learner = await seedLearner(db.sql);
    const { ladderId, flags } = await ladderWithL1Pool(3);
    expect(flags).toEqual(["insufficient-pool"]);
    const attempt = await startMcqAttempt(db.sql, learner, ladderId, "L1", new Date(), async () => ["L0"]);
    expect(attempt).toEqual({ status: 422, error: "pool-too-small" });
  });
});

describe("T013 L1 feedback: run log and 3-sentence explanation (AC 6)", () => {
  test("exactly 3 sentences and at most 600 characters; the run log is optional", () => {
    expect(checkRunFeedback({ explanation: "It starts a server. It reads a config. It prints a URL." })).toEqual({
      runLog: "",
      explanation: "It starts a server. It reads a config. It prints a URL.",
    });
    expect(checkRunFeedback({ runLog: "listening on :3000", explanation: "One! Two? Three." })).toEqual({
      runLog: "listening on :3000",
      explanation: "One! Two? Three.",
    });
  });

  test("2 or 4 sentences, a missing end mark, more than 600 characters or a wrong type are rejected", () => {
    expect(checkRunFeedback({ explanation: "One. Two." })).toBe("explanation-not-3-sentences");
    expect(checkRunFeedback({ explanation: "One. Two. Three. Four." })).toBe("explanation-not-3-sentences");
    expect(checkRunFeedback({ explanation: "One. Two. Three" })).toBe("explanation-not-3-sentences");
    expect(checkRunFeedback({ explanation: `${"a".repeat(600)}. b. c.` })).toBe("explanation-too-long");
    expect(checkRunFeedback({ explanation: 3 })).toBe("invalid-request");
    expect(checkRunFeedback({ explanation: "A. B. C.", runLog: 5 })).toBe("invalid-request");
    expect(checkRunFeedback({ explanation: "A. B. C.", runLog: "x".repeat(20_001) })).toBe("run-log-too-long");
    expect(checkRunFeedback(null)).toBe("invalid-request");
  });
});
