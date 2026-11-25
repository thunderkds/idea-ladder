// T033: a level in POOL_LEVELS (L0, L1, L3) that keeps fewer than MIN_MCQ_POOL MCQs after check-and-dedupe and
// blind-solve gets up to MCQ_TOP_UP_ROUNDS extra rounds. Every top-up question passes the same answer-key check,
// near-duplicate check and blind solve; a level still thin is saved insufficient-pool (no bypass).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { InngestTestEngine } from "@inngest/test";
import type { GeneratedLevel, LadderLevel } from "../src/server/check-and-dedupe.ts";
import { githubRepoClient } from "../src/server/github-repo.ts";
import {
  type CostEntry,
  createInngest,
  LADDER_GENERATE_EVENT,
  ladderGenerateFunction,
} from "../src/server/ladder-generate.ts";
import { generateTopUpMcqs, type LevelChunk, type Mcq } from "../src/server/level-generator.ts";
import { startMcqAttempt } from "../src/server/mcq-test.ts";
import {
  checkTopUp,
  levelsNeedingTopUp,
  solveTopUp,
  type TopUpRound,
  topUpMcqPools,
  topUpStepId,
} from "../src/server/mcq-top-up.ts";
import { migrateUp } from "../src/server/migrate.ts";
import { type Generate, type GenerateInput, type ModelADeps, ModelAFailedError } from "../src/server/model-a.ts";
import { MCQ_TOP_UP_ROUNDS, MIN_MCQ_POOL } from "../src/server/save-ladder.ts";
import type { LevelId } from "../src/shared/levels.ts";
import { createTestDatabase } from "./support/db.ts";
import { type Fixture, fixtureFetch, loadFixture, V0_REPOS } from "./support/github-fixtures.ts";
import { drainInngestRuns } from "./support/inngest-drain.ts";
import { seedLearner } from "./support/mcq-seed.ts";
import { promptData, TEST_CONCEPTS, testReader } from "./support/mock-model.ts";

const usage = { model: "test-model", inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 };

// --- unit: the step plan, the rounds, the checks (no database) ---------------------------------------------------

const CHUNK: LevelChunk = {
  id: 1,
  source: "readme",
  path: "README.md",
  startLine: 1,
  endLine: 3,
  text: "install with bun. start listens on port 3000. config reads DATABASE_URL.",
};
const mcq = (question: string, key = "install"): Mcq => ({
  question,
  options: [key, "option b", "option c", "option d"],
  key,
  chunkId: 1,
});
const level = (id: LevelId, n: number): GeneratedLevel => ({
  level: id,
  status: "generated",
  goal: "g",
  passTest: { kind: "k", description: "d" },
  cards: [],
  mcqs: Array.from({ length: n }, (_, i) => mcq(`${id} kept ${i}?`)),
  dropped: [],
});
const ladder = (counts: Record<LevelId, number>): LadderLevel[] =>
  (Object.entries(counts) as [LevelId, number][]).map(([id, n]) => level(id, n));

describe("T033 levelsNeedingTopUp: the step plan (AC 1, AC 6, Success Criterion 5)", () => {
  test("only an L0/L1/L3 pool below MIN_MCQ_POOL needs a round; L2 and L4 never; a skipped level never", () => {
    const levels = ladder({ L0: MIN_MCQ_POOL, L1: MIN_MCQ_POOL - 1, L2: 0, L3: 0, L4: 0 });
    expect(levelsNeedingTopUp(levels, 1)).toEqual(["L1", "L3"]);
    expect(levelsNeedingTopUp(levels, MCQ_TOP_UP_ROUNDS)).toEqual(["L1", "L3"]);
    const skipped: LadderLevel = { level: "L1", status: "skipped", kind: "concept-only-skipped" };
    expect(levelsNeedingTopUp([level("L0", 3), skipped], 1)).toEqual(["L0"]);
  });

  test("no round past MCQ_TOP_UP_ROUNDS (= 2) and no round 0", () => {
    expect(MCQ_TOP_UP_ROUNDS).toBe(2);
    const levels = ladder({ L0: 0, L1: 0, L2: 0, L3: 0, L4: 0 });
    expect(levelsNeedingTopUp(levels, MCQ_TOP_UP_ROUNDS + 1)).toEqual([]);
    expect(levelsNeedingTopUp(levels, 0)).toEqual([]);
  });

  test("step ids are fixed strings per level and round", () => {
    expect(topUpStepId("L1", 1)).toBe("top-up-L1-1");
    expect(topUpStepId("L3", 2)).toBe("top-up-L3-2");
  });
});

/** A fake round: `gains[level][round - 1]` MCQs pass all checks. Records each round it ran. */
function fakeRounds(gains: Partial<Record<LevelId, number[]>>) {
  const ran: string[] = [];
  const check = async (l: LevelId, round: number): Promise<TopUpRound> => {
    ran.push(topUpStepId(l, round));
    const n = gains[l]?.[round - 1] ?? 0;
    return {
      mcqs: Array.from({ length: n }, (_, i) => mcq(`${l} round ${round} new ${i}?`)),
      dropped: [{ item: mcq(`${l} round ${round} bad?`, "zzz"), reason: "key-check-failed" }],
    };
  };
  const solve = async (_l: LevelId, _round: number, _levels: LadderLevel[], mcqs: Mcq[]): Promise<TopUpRound> => ({
    mcqs,
    dropped: [],
  });
  return { check, solve, ran };
}

describe("T033 topUpMcqPools: the rounds (AC 1, AC 3, AC 5, AC 6)", () => {
  test("a level with MIN_MCQ_POOL - 1 that gains 1 in round 1 stops after round 1", async () => {
    const f = fakeRounds({ L1: [1, 5] });
    const out = await topUpMcqPools({ levels: ladder({ L0: 8, L1: 7, L2: 0, L3: 8, L4: 0 }), ...f });
    expect(f.ran).toEqual(["top-up-L1-1"]);
    expect((out.levels[1] as GeneratedLevel).mcqs).toHaveLength(8);
    expect(out.topUps.L1).toEqual({ rounds: 1, added: 1, dropped: { "key-check-failed": 1 } });
    expect(out.topUps.L0).toEqual({ rounds: 0, added: 0, dropped: {} });
    expect(out.topUps.L2).toBeUndefined();
  });

  test("a level that gains 0 in both rounds runs exactly 2 rounds", async () => {
    const f = fakeRounds({});
    const out = await topUpMcqPools({ levels: ladder({ L0: 8, L1: 5, L2: 0, L3: 8, L4: 0 }), ...f });
    expect(f.ran).toEqual(["top-up-L1-1", "top-up-L1-2"]);
    expect(out.topUps.L1).toEqual({ rounds: 2, added: 0, dropped: { "key-check-failed": 2 } });
  });

  test("levels with 8 or more and L2/L4 get no round and no model call", async () => {
    const f = fakeRounds({});
    const out = await topUpMcqPools({ levels: ladder({ L0: 8, L1: 9, L2: 0, L3: 15, L4: 0 }), ...f });
    expect(f.ran).toEqual([]);
    expect(out.levels).toEqual(ladder({ L0: 8, L1: 9, L2: 0, L3: 15, L4: 0 }));
  });

  test("the round's drops are added to the level's dropped list; more than needed are all kept", async () => {
    const f = fakeRounds({ L3: [6] });
    const out = await topUpMcqPools({ levels: ladder({ L0: 8, L1: 8, L2: 0, L3: 7, L4: 0 }), ...f });
    const l3 = out.levels[3] as GeneratedLevel;
    expect(l3.mcqs).toHaveLength(13);
    expect(l3.dropped.map((d) => d.reason)).toEqual(["key-check-failed"]);
  });
});

/** Model A for the unit checks: a top-up answer of `mcqs`; a regeneration answers `regen` (or a bad key). */
function topUpModelA(mcqs: Mcq[], regen: Mcq = mcq("Regenerated bad?", "zzz")) {
  const inputs: GenerateInput<unknown>[] = [];
  const generate: Generate = async (input) => {
    inputs.push(input as GenerateInput<unknown>);
    const value = input.system?.startsWith("You write one multiple-choice question") ? { mcq: regen } : { mcqs };
    return { value: input.schema.parse(value), usage };
  };
  return { generate, inputs };
}

describe("T033 generateTopUpMcqs: MCQs only, told the kept questions (AC 2)", () => {
  test("asks for MCQs only from the level's chunks, lists the kept questions, runs the citation check", async () => {
    const a = topUpModelA([mcq("New one?"), { ...mcq("Cites another chunk?"), chunkId: 99 }]);
    const out = await generateTopUpMcqs({
      level: "L1",
      chunks: [CHUNK],
      avoid: ["L1 kept 0?", "L1 kept 1?"],
      generate: a.generate,
    });
    expect(out.mcqs.map((m) => m.question)).toEqual(["New one?"]);
    expect(out.dropped.map((d) => d.reason)).toEqual(["bad-citation"]);
    const input = a.inputs[0] as GenerateInput<unknown>;
    expect(input.system).toContain("multiple-choice questions");
    expect(input.system).not.toContain("cards:");
    expect(input.prompt).toContain('"L1 kept 0?"');
    expect(input.prompt).toContain('"L1 kept 1?"');
    expect(promptData(input.prompt)?.chunks.map((c) => c.id)).toEqual([1]);
  });
});

describe("T033 checkTopUp and solveTopUp: the same three checks (AC 2, Success Criterion 2)", () => {
  const levels = [level("L0", 2), level("L1", 5)];

  test("a key that is not a span of the chunk is dropped key-check-failed after 2 regenerations", async () => {
    const a = topUpModelA([]);
    const out = await checkTopUp({
      level: "L1",
      generated: { mcqs: [mcq("Which value is the key?", "zzz")], dropped: [] },
      levels,
      chunks: [CHUNK],
      generate: a.generate,
      dedupeJaccard: 0.8,
    });
    expect(out.mcqs).toEqual([]);
    expect(out.dropped.map((d) => d.reason)).toEqual(["key-check-failed"]);
    expect(a.inputs).toHaveLength(2);
  });

  test("a near-duplicate of a kept question (this level or another) is dropped duplicate", async () => {
    const out = await checkTopUp({
      level: "L1",
      generated: { mcqs: [mcq("L1 kept 3?"), mcq("L0 kept 1?"), mcq("A fresh question here?")], dropped: [] },
      levels,
      chunks: [CHUNK],
      generate: topUpModelA([]).generate,
      dedupeJaccard: 0.8,
    });
    expect(out.mcqs.map((m) => m.question)).toEqual(["A fresh question here?"]);
    expect(out.dropped.map((d) => d.reason)).toEqual(["duplicate", "duplicate"]);
  });

  test("model B disagrees: dropped blind-solve-mismatch; agrees: kept", async () => {
    const b: Generate = async ({ schema, prompt }) => {
      const d = JSON.parse(prompt.split("\n")[1] as string) as { question: string; options: string[] };
      const pick = d.question.startsWith("Disputed") ? "option b" : "install";
      return { value: schema.parse({ answerIndex: d.options.indexOf(pick) }), usage };
    };
    const out = await solveTopUp({
      level: "L1",
      candidates: [mcq("Disputed question?"), mcq("Agreed question?")],
      levels,
      chunks: [CHUNK],
      generateA: topUpModelA([]).generate,
      generateB: b,
      dedupeJaccard: 0.8,
    });
    expect(out.mcqs.map((m) => m.question)).toEqual(["Agreed question?"]);
    expect(out.dropped.map((d) => d.reason)).toEqual(["blind-solve-mismatch"]);
  });
});

// --- integration: the real ladderGenerateFunction with mock models, test Postgres --------------------------------

let db: Awaited<ReturnType<typeof createTestDatabase>>;
let fixtures: Fixture[];
beforeAll(async () => {
  db = await createTestDatabase();
  await migrateUp(db.sql);
  fixtures = [await loadFixture("developit/mitt")];
});
afterAll(async () => {
  await db.drop();
});
afterEach(drainInngestRuns);
beforeEach(async () => {
  await db.sql`TRUNCATE generation_jobs, repo_snapshots, ladders, users CASCADE`;
});

const MITT = { repo: "developit/mitt", sha: V0_REPOS["developit/mitt"] };
const newJob = async () =>
  (
    await db.sql`
    INSERT INTO generation_jobs (repo_full_name, commit_sha) VALUES (${MITT.repo}, ${MITT.sha}) RETURNING id::text`
  )[0].id as string;
const fileText = (path: string) => Array.from({ length: 120 }, (_, i) => `${path} line ${i + 1}`).join("\n");

type Data = { level: LevelId; chunks: { id: number; text: string }[] };
const firstWord = (d: Data) => (d.chunks[0]?.text.match(/[\p{L}\p{N}]+/u)?.[0] ?? "a") as string;
/** An MCQ on the first chunk of the data whose key is that chunk's first word (passes the answer-key check). */
const valid = (d: Data, question: string): Mcq => ({
  question,
  options: [firstWord(d), "option b", "option c", "option d"],
  key: firstWord(d),
  chunkId: d.chunks[0]?.id as number,
});
const WORDS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet"];

/**
 * Model A: the mapper gets TEST_CONCEPTS; the first-round generator of a level gets `first[level]` valid MCQs and 5
 * cards; the top-up of a level gets `topUp(level, data, call)` (call = 1, 2 ... per level); a regeneration gets an
 * MCQ with a key that is never in a chunk.
 */
function poolModelA(first: Partial<Record<LevelId, number>>, topUp: (l: LevelId, d: Data, call: number) => Mcq[]) {
  const calls: Partial<Record<LevelId, number>> = {};
  const deps: ModelADeps = {
    backend: "api",
    generate: async (input) => {
      const concepts = input.schema.safeParse({ concepts: TEST_CONCEPTS });
      if (concepts.success) return { value: concepts.data, usage };
      const d = promptData(input.prompt) as Data;
      if (input.system?.startsWith("You write one multiple-choice question"))
        return { value: input.schema.parse({ mcq: { ...valid(d, "Regenerated bad?"), key: "zzz" } }), usage };
      if (input.system?.startsWith("You write more multiple-choice questions")) {
        calls[d.level] = (calls[d.level] ?? 0) + 1;
        return { value: input.schema.parse({ mcqs: topUp(d.level, d, calls[d.level] as number) }), usage };
      }
      const n = d.chunks.length === 0 ? 0 : (first[d.level] ?? 0);
      const value = {
        goal: "Test goal",
        passTest: { kind: "x", description: "Test pass test" },
        cards:
          d.chunks.length === 0
            ? []
            : WORDS.slice(0, 5).map((w) => ({ front: `${d.level} card ${w}?`, back: "b", chunkId: d.chunks[0]?.id })),
        mcqs: Array.from({ length: n }, (_, i) => valid(d, `${d.level} first ${WORDS[i]}?`)),
      };
      return { value: input.schema.parse(value), usage };
    },
  };
  const reset = () => {
    for (const l of Object.keys(calls)) delete calls[l as LevelId];
  };
  return { deps, topUpCalls: (l: LevelId) => calls[l] ?? 0, reset };
}

/** Model B: picks the chunk's first word (the key of every valid MCQ), except as `override` says. */
function poolModelB(override: (question: string) => "wrong" | "throw" | undefined = () => undefined): ModelADeps {
  return {
    backend: "api",
    generate: async ({ schema, prompt }) => {
      const d = JSON.parse(prompt.split("\n")[1] ?? "{}") as { chunk: string; question: string; options: string[] };
      const what = override(d.question);
      if (what === "throw") throw new Error("cost log unavailable");
      const key = d.chunk.match(/[\p{L}\p{N}]+/u)?.[0] ?? "";
      const i = d.options.indexOf(key);
      return {
        value: schema.parse({ answerIndex: what === "wrong" ? (i + 1) % 4 : Math.max(i, 0) }),
        usage: { ...usage, model: "test-model-b" },
      };
    },
  };
}

function engine(
  jobId: string,
  a: ModelADeps,
  b: ModelADeps,
  costs: CostEntry[] = [],
  logCost: (e: CostEntry) => void = (e) => costs.push(e),
) {
  const gh = fixtureFetch(fixtures, (path) => {
    const m = path.match(/^\/repos\/developit\/mitt\/contents\/([^?]+)\?ref=/);
    return m ? new Response(fileText(decodeURIComponent(m[1] as string))) : undefined;
  });
  const fn = ladderGenerateFunction(createInngest(), {
    sql: db.sql,
    github: githubRepoClient({ baseUrl: "https://api.github.com", token: "t", fetch: gh.impl }),
    reader: { ...testReader(), logCost },
    modelA: a,
    modelB: b,
    stepCosts: () => null,
  });
  return new InngestTestEngine({ function: fn, events: [{ name: LADDER_GENERATE_EVENT, data: { ...MITT, jobId } }] });
}

type Report = { levels: { level: string; flags: string[]; kept: { mcqs: number }; topUp?: unknown }[] };
async function saved() {
  const [ladder] = await db.sql`SELECT id::text AS id FROM ladders`;
  const [{ report }] = await db.sql`SELECT report FROM generation_reports WHERE ladder_id = ${ladder.id}`;
  const questions = async (l: LevelId): Promise<string[]> =>
    (await db.sql`SELECT question FROM mcqs WHERE ladder_id = ${ladder.id} AND level = ${l} ORDER BY position`).map(
      (r: { question: string }) => r.question,
    );
  const level = (l: LevelId) => (report as Report).levels.find((x) => x.level === l);
  return { ladderId: ladder.id as string, report: report as Report, questions, level };
}
const FULL = { L0: 8, L1: 5, L3: 8 };
type Memo = { id: string; handler: () => Promise<unknown> }[];
/** Each step of a run that ran before `stop`, with its output (what Inngest replays on a retry). */
async function memoBefore(
  run: Awaited<ReturnType<ReturnType<typeof engine>["execute"]>>,
  stop: (id: string) => boolean,
) {
  const ran = run.ctx.step.run.mock.calls.map((c) => c[0] as string);
  const end = ran.findIndex(stop);
  return await Promise.all(
    ran.slice(0, end < 0 ? ran.length : end).map(async (id, i) => {
      const value = await (run.ctx.step.run.mock.results[i] as { value?: unknown }).value;
      return { id, handler: async () => value };
    }),
  );
}
/**
 * @inngest/test runs every step after a parallel group (generate-level-*) once per chain of that group, so a model
 * call count there is not the real one. This runs the job once, memoizes every step before the top-up, resets the
 * saved ladder and the counters, and returns the memo: a run with it has one chain, as on Inngest.
 */
async function memoBeforeTopUp(jobId: string, a: ReturnType<typeof poolModelA>, b: ModelADeps): Promise<Memo> {
  const memo = await memoBefore(await engine(jobId, a.deps, b).execute(), (id) => id.startsWith("top-up-"));
  await drainInngestRuns();
  await db.sql`UPDATE generation_jobs SET status = 'mapped' WHERE id = ${jobId}`;
  await db.sql`TRUNCATE ladders CASCADE`;
  a.reset();
  return memo;
}

describe("T033 top-up in ladder-generate (Success Criteria 1 to 5)", () => {
  test("SC 1: L1 keeps 5, the top-up returns 4 valid: one round, L1 saved with 9, no insufficient-pool", async () => {
    const jobId = await newJob();
    const a = poolModelA(FULL, (_l, d) => WORDS.slice(0, 4).map((w) => valid(d, `Top-up ${w} question?`)));
    const steps = await memoBeforeTopUp(jobId, a, poolModelB());
    const costs: CostEntry[] = [];
    const { result, ctx } = await engine(jobId, a.deps, poolModelB(), costs).execute({ steps });
    expect(result).toMatchObject({ status: "done" });
    const ids = ctx.step.run.mock.calls.map((c) => c[0] as string);
    expect(ids.filter((id) => id.startsWith("top-up-"))).toEqual(["top-up-L1-1", "top-up-L1-1-blind-solve"]);
    expect(ids.slice(-1)).toEqual(["save-ladder"]);
    expect(a.topUpCalls("L1")).toBe(1);
    const s = await saved();
    expect(await s.questions("L1")).toHaveLength(9);
    expect(s.level("L1")?.flags).toEqual([]);
    expect(s.level("L1")?.topUp).toEqual({ rounds: 1, added: 4, dropped: {} });
    // AC 5: the round's model calls (model A and model B) are logged under the round's step id.
    const logged = new Set(costs.map((c) => c.step));
    expect([...logged].filter((st) => st.startsWith("top-up-"))).toEqual(["top-up-L1-1"]);
    expect(costs.filter((c) => c.step === "top-up-L1-1").map((c) => c.model)).toContain("test-model-b");
  });

  test("SC 2: a bad key, a near-duplicate and a model B disagreement are dropped with their reasons, never saved", async () => {
    const jobId = await newJob();
    const a = poolModelA(FULL, (_l, d) => [
      { ...valid(d, "Top-up bad key question?"), key: "zzz", options: ["zzz", "option b", "option c", "option d"] },
      valid(d, "L1 first alpha?"),
      valid(d, "Disputed top-up question?"),
      ...WORDS.slice(0, 3).map((w) => valid(d, `Top-up ${w} question?`)),
    ]);
    const b = poolModelB((q) => (q.startsWith("Disputed") ? "wrong" : undefined));
    const { result } = await engine(jobId, a.deps, b).execute();
    expect(result).toMatchObject({ status: "done" });
    const s = await saved();
    const l1 = await s.questions("L1");
    expect(l1).toHaveLength(8);
    expect(l1).not.toContain("Top-up bad key question?");
    expect(l1).not.toContain("Disputed top-up question?");
    expect(l1.filter((q) => q === "L1 first alpha?")).toHaveLength(1);
    expect(s.level("L1")?.topUp).toEqual({
      rounds: 1,
      added: 3,
      dropped: { "key-check-failed": 1, duplicate: 1, "blind-solve-mismatch": 1 },
    });
  });

  test("SC 3: 1 valid per round (5 -> 6 -> 7): exactly 2 rounds, L1 saved with 7 insufficient-pool, attempt 422", async () => {
    const jobId = await newJob();
    const a = poolModelA(FULL, (_l, d, call) => [valid(d, `Top-up round ${WORDS[call]} question?`)]);
    const { result, ctx } = await engine(jobId, a.deps, poolModelB()).execute();
    expect(result).toMatchObject({ status: "done" });
    const ids = ctx.step.run.mock.calls.map((c) => c[0] as string).filter((id) => id.startsWith("top-up-"));
    expect(ids).toEqual(["top-up-L1-1", "top-up-L1-1-blind-solve", "top-up-L1-2", "top-up-L1-2-blind-solve"]);
    const s = await saved();
    expect(await s.questions("L1")).toHaveLength(7);
    expect(s.level("L1")?.flags).toEqual(["insufficient-pool"]);
    expect(s.level("L1")?.topUp).toEqual({ rounds: 2, added: 2, dropped: {} });
    const learner = await seedLearner(db.sql);
    expect(await startMcqAttempt(db.sql, learner, s.ladderId, "L1", new Date(), async () => ["L0"])).toEqual({
      status: 422,
      error: "pool-too-small",
    });
  });

  test("SC 4: blind-solve throws once inside a top-up round: the step retries, the top-up generator ran once", async () => {
    const jobId = await newJob();
    const a = poolModelA(FULL, (_l, d) => WORDS.slice(0, 4).map((w) => valid(d, `Top-up ${w} question?`)));
    const throwing = poolModelB((q) => (q.startsWith("Top-up") ? "throw" : undefined));
    const steps = await memoBeforeTopUp(jobId, a, throwing);
    const failed = await engine(jobId, a.deps, throwing).execute({ steps });
    expect(failed.ctx.step.run.mock.calls.map((c) => c[0] as string).at(-1)).toBe("top-up-L1-1-blind-solve");
    expect(a.topUpCalls("L1")).toBe(1);
    expect((await db.sql`SELECT count(*)::int AS n FROM ladders`)[0].n).toBe(0);
    // Inngest retries the failed step with every earlier step memoized, top-up-L1-1 included.
    const memo = await memoBefore(failed, (id) => id === "top-up-L1-1-blind-solve");
    expect(memo.map((m) => m.id)).toContain("top-up-L1-1");
    const retry = await engine(jobId, a.deps, poolModelB()).execute({ steps: memo });
    expect(retry.result).toMatchObject({ status: "done" });
    expect(a.topUpCalls("L1")).toBe(1);
    expect(await (await saved()).questions("L1")).toHaveLength(9);
  });

  test("SC 5: every pool at 8 or more: no top-up step, no top-up model call; L2 and L4 never topped up", async () => {
    const jobId = await newJob();
    const a = poolModelA({ L0: 8, L1: 8, L3: 9 }, () => []);
    const { result, ctx } = await engine(jobId, a.deps, poolModelB()).execute();
    expect(result).toMatchObject({ status: "done" });
    expect(ctx.step.run.mock.calls.map((c) => c[0] as string).filter((id) => id.startsWith("top-up-"))).toEqual([]);
    for (const l of ["L0", "L1", "L2", "L3", "L4"] as LevelId[]) expect(a.topUpCalls(l)).toBe(0);
    const s = await saved();
    expect(s.level("L2")?.topUp).toBeUndefined();
    expect(s.level("L4")?.topUp).toBeUndefined();
    expect(s.level("L1")?.topUp).toEqual({ rounds: 0, added: 0, dropped: {} });
  });

  test("edge: the top-up generator has a model failure: the round counts as run with 0 added, the level is saved thin, job done", async () => {
    const jobId = await newJob();
    const a = poolModelA(FULL, () => {
      throw new ModelAFailedError("claude -p timeout");
    });
    const { result } = await engine(jobId, a.deps, poolModelB()).execute();
    expect(result).toMatchObject({ status: "done" });
    const s = await saved();
    expect(s.level("L1")?.flags).toEqual(["insufficient-pool"]);
    expect(s.level("L1")?.topUp).toEqual({ rounds: 2, added: 0, dropped: {} });
  });

  test("edge: a non-model error in the top-up generator call (cost-log fault) is rethrown; the retried step succeeds", async () => {
    const jobId = await newJob();
    const a = poolModelA(FULL, (_l, d) => WORDS.slice(0, 4).map((w) => valid(d, `Top-up ${w} question?`)));
    const steps = await memoBeforeTopUp(jobId, a, poolModelB());
    const faulty = (e: CostEntry) => {
      if (e.step === "top-up-L1-1") throw new Error("cost log unwritable");
    };
    const failed = await engine(jobId, a.deps, poolModelB(), [], faulty).execute({ steps });
    expect(failed.ctx.step.run.mock.calls.map((c) => c[0] as string).at(-1)).toBe("top-up-L1-1");
    expect((failed as { error?: Error }).error?.message).toMatch(/top-up-L1-1: cost log unwritable/);
    expect((await db.sql`SELECT count(*)::int AS n FROM ladders`)[0].n).toBe(0);
    // Inngest retries the failed step with every earlier step memoized.
    const memo = await memoBefore(failed, (id) => id === "top-up-L1-1");
    const retry = await engine(jobId, a.deps, poolModelB()).execute({ steps: memo });
    expect(retry.result).toMatchObject({ status: "done" });
    const s = await saved();
    expect(await s.questions("L1")).toHaveLength(9);
    expect(s.level("L1")?.topUp).toEqual({ rounds: 1, added: 4, dropped: {} });
  });
});
