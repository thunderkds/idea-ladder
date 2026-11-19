// T008 (8d) AC 7 / AC 8 / Success Criteria 6 and 7: step save-ladder writes the ladder, job done; no partial ladder.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { InngestTestEngine } from "@inngest/test";
import type { GeneratedLevel, LadderLevel } from "../src/server/check-and-dedupe.ts";
import { type GithubRepoClient, githubRepoClient } from "../src/server/github-repo.ts";
import {
  type CostEntry,
  createInngest,
  LADDER_GENERATE_EVENT,
  ladderGenerateFunction,
} from "../src/server/ladder-generate.ts";
import { migrateUp } from "../src/server/migrate.ts";
import { type ModelADeps, ModelAFailedError } from "../src/server/model-a.ts";
import { buildReport, saveLadder } from "../src/server/save-ladder.ts";
import { jobForLearner, startLadder } from "../src/server/start.ts";
import { createTestDatabase } from "./support/db.ts";
import { type Fixture, fixtureFetch, loadFixture, V0_REPOS } from "./support/github-fixtures.ts";
import { drainInngestRuns } from "./support/inngest-drain.ts";
import { promptData, testModelA, testModelB, testReader } from "./support/mock-model.ts";

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
// A test's parallel run keeps steps going after `execute()` returns: let them end before the next test truncates.
afterEach(drainInngestRuns);
beforeEach(async () => {
  await db.sql`TRUNCATE generation_jobs, repo_snapshots, ladders, users CASCADE`;
});

const MITT = { repo: "developit/mitt", sha: V0_REPOS["developit/mitt"] };
const LEVEL_STEPS = ["L0", "L1", "L2", "L3", "L4"].map((l) => `generate-level-${l}`);
const newJob = async (userId: string | null = null) =>
  (
    await db.sql`
    INSERT INTO generation_jobs (repo_full_name, commit_sha, started_by) VALUES (${MITT.repo}, ${MITT.sha}, ${userId})
    RETURNING id::text`
  )[0].id as string;
const jobRow = async (id: string) =>
  (await db.sql`SELECT status, reason FROM generation_jobs WHERE id = ${id}`)[0] as {
    status: string;
    reason: string | null;
  };
const ladderCount = async () => (await db.sql`SELECT count(*)::int AS n FROM ladders`)[0].n as number;
const fileText = (path: string) => Array.from({ length: 120 }, (_, i) => `${path} line ${i + 1}`).join("\n");

/** testModelA recording the level of each generator call; `fail(level)` may throw for a level. */
function failingModelA(fail?: (level: string) => Error | undefined): ModelADeps & { levels: string[] } {
  const base = testModelA();
  const levels: string[] = [];
  return {
    backend: "api",
    levels,
    generate: async (input) => {
      const data = promptData(input.prompt);
      if (data?.level) {
        levels.push(data.level);
        const err = fail?.(data.level);
        if (err) throw err;
      }
      return await base.generate(input);
    },
  };
}

function engine(jobId: string, modelA: ModelADeps, opts: { costs?: CostEntry[] } = {}) {
  const gh = fixtureFetch(fixtures, (path) => {
    const m = path.match(/^\/repos\/developit\/mitt\/contents\/([^?]+)\?ref=/);
    return m ? new Response(fileText(decodeURIComponent(m[1] as string))) : undefined;
  });
  const costs = opts.costs ?? [];
  const fn = ladderGenerateFunction(createInngest(), {
    sql: db.sql,
    github: githubRepoClient({ baseUrl: "https://api.github.com", token: "t", fetch: gh.impl }),
    reader: { ...testReader(), logCost: (e) => costs.push(e) },
    modelA,
    modelB: testModelB(),
    // This job's cost entries per step (main.ts reads them from the job's cost log).
    stepCosts: () => {
      const byStep: Record<
        string,
        { calls: number; inputTokens: number; outputTokens: number; cachedInputTokens: number; usd: number | null }
      > = {};
      for (const c of costs) {
        const t = byStep[c.step] ?? { calls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, usd: null };
        byStep[c.step] = t;
        t.calls += 1;
        t.inputTokens += c.inputTokens;
        t.outputTokens += c.outputTokens;
        t.cachedInputTokens += c.cachedInputTokens;
      }
      return byStep;
    },
  });
  const t = new InngestTestEngine({
    function: fn,
    events: [{ name: LADDER_GENERATE_EVENT, data: { ...MITT, jobId } }],
  });
  return { t, fn };
}
async function runOnFailure(fn: ReturnType<typeof engine>["fn"], jobId: string, error: Error) {
  const onFailure = fn.opts.onFailure as unknown as (ctx: { event: unknown; error: Error }) => Promise<unknown>;
  await onFailure({
    event: {
      name: "inngest/function.failed",
      data: { event: { name: LADDER_GENERATE_EVENT, data: { ...MITT, jobId } } },
    },
    error,
  });
}

// --- pure report and flags ---------------------------------------------------------------------------------------

const card = (n: number) => ({ front: `front ${n}`, back: `back ${n}`, chunkId: 1 });
const mcq = (n: number) => ({ question: `question ${n}?`, options: ["a", "b", "c", "d"], key: "a", chunkId: 1 });
const generated = (level: GeneratedLevel["level"], over: Partial<GeneratedLevel> = {}): GeneratedLevel => ({
  level,
  status: "generated",
  goal: `goal ${level}`,
  passTest: { kind: `kind-${level}`, description: `desc ${level}` },
  cards: [],
  mcqs: [],
  dropped: [],
  ...over,
});
const skipped = (level: GeneratedLevel["level"]): LadderLevel => ({
  level,
  status: "skipped",
  kind: "concept-only-skipped",
});

describe("save-ladder report and flags (AC 7, AC 8)", () => {
  test("generated = kept + dropped, split into cards and MCQs (a dropped item with a key is an MCQ); dropped per reason", () => {
    const report = buildReport(
      [
        generated("L3", {
          cards: [card(1), card(2)],
          mcqs: Array.from({ length: 9 }, (_, i) => mcq(i)),
          dropped: [
            { item: mcq(20), reason: "key-check-failed" },
            { item: mcq(21), reason: "key-check-failed" },
            { item: card(22), reason: "duplicate" },
            { item: mcq(23), reason: "bad-citation" },
          ],
        }),
        skipped("L4"),
      ],
      { "generate-level-L3": { calls: 1, inputTokens: 10, outputTokens: 5, cachedInputTokens: 0, usd: null } },
    );
    expect(report.levels).toEqual([
      {
        level: "L3",
        status: "generated",
        generated: { cards: 3, mcqs: 12 },
        kept: { cards: 2, mcqs: 9 },
        dropped: { "key-check-failed": 2, duplicate: 1, "bad-citation": 1 },
        flags: ["insufficient-cards"],
      },
      {
        level: "L4",
        status: "skipped",
        generated: { cards: 0, mcqs: 0 },
        kept: { cards: 0, mcqs: 0 },
        dropped: {},
        flags: [],
      },
    ]);
    expect(report.costByStep).toEqual({
      "generate-level-L3": { calls: 1, inputTokens: 10, outputTokens: 5, cachedInputTokens: 0, usd: null },
    });
  });

  test("insufficient-pool only for an L0/L3 pool below 8; insufficient-cards below 5 cards; a skipped level has no flag", () => {
    const five = Array.from({ length: 5 }, (_, i) => card(i));
    const seven = Array.from({ length: 7 }, (_, i) => mcq(i));
    const flags = buildReport(
      [
        generated("L0", { cards: five, mcqs: seven }),
        generated("L1", { cards: five }),
        generated("L2", { cards: five.slice(1) }),
        generated("L3", { cards: five, mcqs: [...seven, mcq(8)] }),
        skipped("L4"),
      ],
      null,
    ).levels.map((l) => l.flags);
    expect(flags).toEqual([["insufficient-pool"], [], ["insufficient-cards"], [], []]);
  });
});

// --- saveLadder (one transaction) --------------------------------------------------------------------------------

async function seedChunk() {
  await db.sql`INSERT INTO repo_snapshots (repo_full_name, commit_sha, default_branch, archived, readme, topics, languages, dep_files, open_issues, good_first_issues, tree, tree_truncated)
    VALUES (${MITT.repo}, ${MITT.sha}, 'main', false, 'r', '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, 0, 0, '[]'::jsonb, false)`;
  const [c] =
    await db.sql`INSERT INTO chunks (repo_full_name, commit_sha, source, path, ordinal, start_line, end_line, text)
    VALUES (${MITT.repo}, ${MITT.sha}, 'core', 'src/index.ts', 0, 1, 2, 't') RETURNING id::int AS id`;
  return c.id as number;
}

describe("saveLadder (AC 7, AC 8, edge case: retried save-ladder)", () => {
  test("writes the ladder unverified, 5 levels, cards, MCQ pools and the report; job done; a retry adds no row", async () => {
    const chunkId = await seedChunk();
    const jobId = await newJob();
    await db.sql`UPDATE generation_jobs SET status = 'mapped' WHERE id = ${jobId}`;
    const c = (n: number) => ({ ...card(n), chunkId });
    const m = (n: number) => ({ ...mcq(n), chunkId });
    const levels: LadderLevel[] = [
      generated("L0", { cards: [c(0)], mcqs: [m(0), m(1)] }),
      generated("L1", { cards: [c(1), c(2)] }),
      generated("L2", { cards: [c(3)] }),
      generated("L3", { cards: [c(4)], mcqs: [m(2)], dropped: [{ item: m(3), reason: "key-check-failed" }] }),
      generated("L4", { cards: [c(5)] }),
    ];
    const input = { jobId, repo: MITT.repo, sha: MITT.sha, levels, costByStep: null };
    const first = await saveLadder(db.sql, input);
    const again = await saveLadder(db.sql, input);
    expect(again).toEqual(first);
    expect(await db.sql`SELECT id::text AS id, status FROM ladders`).toEqual([
      { id: first.ladderId, status: "unverified" },
    ]);
    const rows = await db.sql`
      SELECT level, title, goal, pass_test_kind, pass_test_description, skip_reason, flags FROM ladder_levels
      WHERE ladder_id = ${first.ladderId} ORDER BY level`;
    expect(
      rows.map((r: { level: string; goal: string; pass_test_kind: string; flags: string[] }) => [
        r.level,
        r.goal,
        r.pass_test_kind,
        r.flags,
      ]),
    ).toEqual([
      ["L0", "goal L0", "kind-L0", ["insufficient-pool", "insufficient-cards"]],
      ["L1", "goal L1", "kind-L1", ["insufficient-cards"]],
      ["L2", "goal L2", "kind-L2", ["insufficient-cards"]],
      ["L3", "goal L3", "kind-L3", ["insufficient-pool", "insufficient-cards"]],
      ["L4", "goal L4", "kind-L4", ["insufficient-cards"]],
    ]);
    expect(rows[0]).toMatchObject({ title: "Prerequisites", pass_test_description: "desc L0", skip_reason: null });
    const cards =
      await db.sql`SELECT level, position, front, back, chunk_id::int AS chunk_id FROM review_cards ORDER BY level, position`;
    expect(cards.map((r: { level: string; front: string }) => [r.level, r.front])).toEqual([
      ["L0", "front 0"],
      ["L1", "front 1"],
      ["L1", "front 2"],
      ["L2", "front 3"],
      ["L3", "front 4"],
      ["L4", "front 5"],
    ]);
    expect(cards[0]).toMatchObject({ position: 0, back: "back 0", chunk_id: chunkId });
    const mcqs =
      await db.sql`SELECT level, position, question, options, key, chunk_id::int AS chunk_id FROM mcqs ORDER BY level, position`;
    expect(mcqs).toEqual([
      { level: "L0", position: 0, question: "question 0?", options: ["a", "b", "c", "d"], key: "a", chunk_id: chunkId },
      { level: "L0", position: 1, question: "question 1?", options: ["a", "b", "c", "d"], key: "a", chunk_id: chunkId },
      { level: "L3", position: 0, question: "question 2?", options: ["a", "b", "c", "d"], key: "a", chunk_id: chunkId },
    ]);
    const [report] = await db.sql`SELECT report FROM generation_reports WHERE ladder_id = ${first.ladderId}`;
    expect(report.report).toEqual(buildReport(levels, null));
    expect(await jobRow(jobId)).toEqual({ status: "done", reason: null });
  });

  test("concept-only ladder: L1-L4 rows saved with skip_reason concept-only-skipped and the fixed pass test", async () => {
    await seedChunk();
    const jobId = await newJob();
    const { ladderId } = await saveLadder(db.sql, {
      jobId,
      repo: MITT.repo,
      sha: MITT.sha,
      levels: [generated("L0"), ...(["L1", "L2", "L3", "L4"] as const).map(skipped)],
      costByStep: null,
    });
    const rows = await db.sql`
      SELECT level, pass_test_kind, skip_reason, flags FROM ladder_levels WHERE ladder_id = ${ladderId} ORDER BY level`;
    expect(rows).toEqual([
      { level: "L0", pass_test_kind: "kind-L0", skip_reason: null, flags: ["insufficient-pool", "insufficient-cards"] },
      { level: "L1", pass_test_kind: "run-evidence", skip_reason: "concept-only-skipped", flags: [] },
      { level: "L2", pass_test_kind: "diff-questions", skip_reason: "concept-only-skipped", flags: [] },
      { level: "L3", pass_test_kind: "core-mcq", skip_reason: "concept-only-skipped", flags: [] },
      { level: "L4", pass_test_kind: "repo-or-pr-link", skip_reason: "concept-only-skipped", flags: [] },
    ]);
  });
});

// --- the workflow end to end -------------------------------------------------------------------------------------

describe("step save-ladder in ladder-generate (AC 7, AC 8, SC 6, SC 7)", () => {
  test("after check-and-dedupe: ladder unverified with its report and cost per step, job done with ladderId; next /start is a cache hit", async () => {
    const [user] = await db.sql`INSERT INTO users (github_id, github_login) VALUES (1, 'learner') RETURNING id::text`;
    const jobId = await newJob(user.id);
    await db.sql`INSERT INTO generation_job_waiters (job_id, user_id) VALUES (${jobId}, ${user.id})`;
    const { result, ctx } = await engine(jobId, failingModelA()).t.execute();
    expect(ctx.step.run.mock.calls.map((c) => c[0]).slice(-3)).toEqual([
      "check-and-dedupe",
      "blind-solve",
      "save-ladder",
    ]);
    const [ladder] = await db.sql`SELECT id::text AS id, status FROM ladders`;
    expect(ladder.status).toBe("unverified");
    expect(result).toMatchObject({ status: "done", ladderId: ladder.id });
    expect(await jobRow(jobId)).toEqual({ status: "done", reason: null });
    expect(await jobForLearner(db.sql, jobId, user.id)).toMatchObject({ status: "done", ladderId: ladder.id });
    const [{ report }] = await db.sql`SELECT report FROM generation_reports WHERE ladder_id = ${ladder.id}`;
    expect(report.levels.map((l: { level: string }) => l.level)).toEqual(["L0", "L1", "L2", "L3", "L4"]);
    expect(Object.keys(report.costByStep)).toEqual(
      expect.arrayContaining(["map-concepts", "pick-core-files", ...LEVEL_STEPS]),
    );
    expect((await db.sql`SELECT count(*)::int AS n FROM ladder_levels WHERE ladder_id = ${ladder.id}`)[0].n).toBe(5);
    // T005 AC 2: a second /start for this repo + SHA is now a cache hit (no new job).
    const github = { resolveHead: async () => ({ fullName: MITT.repo, sha: MITT.sha }) } as unknown as GithubRepoClient;
    const enqueue = async () => {
      throw new Error("no job expected");
    };
    expect(
      await startLadder({ sql: db.sql, github, enqueue, maxNewJobsPerHour: 5 }, user.id, {
        owner: "developit",
        name: "mitt",
      } as never),
    ).toEqual({
      ladderId: ladder.id,
    });
  });

  test("Success Criterion 6: generate-level-L2 throws once -> only that step retried; ladder saved unverified, job done", async () => {
    const jobId = await newJob();
    let thrown = 0;
    const modelA = failingModelA((level) =>
      level === "L2" && thrown++ === 0 ? new ModelAFailedError("timeout") : undefined,
    );
    const { t } = engine(jobId, modelA);
    const first = await t.execute();
    expect((first as { error?: Error }).error?.message).toMatch(/generate-level-L2: /);
    expect(await ladderCount()).toBe(0);
    // Inngest memoizes completed steps; the retry (fresh engine) re-runs only generate-level-L2. The test engine leaves
    // the parallel steps of a failed run pending, so the other levels are memoized as marker results.
    const results = first.ctx.step.run.mock.results;
    const ran = first.ctx.step.run.mock.calls.map((c) => c[0]);
    const memo = await Promise.all(
      ["fetch-repo", "pick-core-files", "map-concepts", "chunk"].map(async (id) => {
        const value = await (results[ran.indexOf(id)] as { value?: unknown }).value;
        return { id, handler: async () => value };
      }),
    );
    for (const id of LEVEL_STEPS.filter((s) => s !== "generate-level-L2")) {
      const marker = { ...generated(id.slice(-2) as GeneratedLevel["level"]), goal: `memoized ${id}` };
      memo.push({ id, handler: async () => marker });
    }
    const retryModelA = failingModelA();
    const retry = await engine(jobId, retryModelA).t.execute({ steps: memo });
    expect(new Set(retryModelA.levels)).toEqual(new Set(["L2"]));
    expect(retry.result).toMatchObject({ status: "done" });
    const goals = await db.sql`SELECT level, goal FROM ladder_levels ORDER BY level`;
    expect(goals.map((r: { goal: string }) => r.goal.startsWith("memoized"))).toEqual([true, true, false, true, true]);
    expect(await db.sql`SELECT status FROM ladders`).toEqual([{ status: "unverified" }]);
    expect((await jobRow(jobId)).status).toBe("done");
  });

  test("Success Criterion 7: fallbackToConcepts -> concept-only ladder saved, L1-L4 concept-only-skipped", async () => {
    const first = await newJob();
    await engine(first, failingModelA()).t.execute();
    await drainInngestRuns(); // a stray save-ladder of the first run must not write after the DELETE
    await db.sql`DELETE FROM ladders`;
    await db.sql`UPDATE generation_jobs SET status = 'failed' WHERE id = ${first}`;
    await db.sql`UPDATE repo_confidence SET fallback_to_concepts = true WHERE repo_full_name = ${MITT.repo}`;
    const jobId = await newJob();
    const modelA = failingModelA();
    const { result } = await engine(jobId, modelA).t.execute();
    expect(new Set(modelA.levels)).toEqual(new Set(["L0"]));
    expect(result).toMatchObject({ status: "done" });
    const rows = await db.sql`SELECT level, skip_reason FROM ladder_levels ORDER BY level`;
    expect(rows).toEqual([
      { level: "L0", skip_reason: null },
      ...["L1", "L2", "L3", "L4"].map((level) => ({ level, skip_reason: "concept-only-skipped" })),
    ]);
    expect((await jobRow(jobId)).status).toBe("done");
  });

  test("AC 8: a generator step failing after its retries fails the job generate-level-L4-failed and saves no ladder", async () => {
    const jobId = await newJob();
    const { t, fn } = engine(
      jobId,
      failingModelA((level) => (level === "L4" ? new ModelAFailedError("timeout") : undefined)),
    );
    const run = await t.execute();
    await runOnFailure(fn, jobId, (run as { error?: Error }).error as Error);
    expect(await jobRow(jobId)).toEqual({ status: "failed", reason: "generate-level-L4-failed" });
    expect(await ladderCount()).toBe(0);
  });

  test("check-and-dedupe failing on every attempt: after the last retry the job fails check-and-dedupe-failed, no ladder", async () => {
    const jobId = await newJob();
    // Every generated key is wrong, so check-and-dedupe regenerates; the regeneration call (and every retry) fails.
    const base = failingModelA();
    const modelA: ModelADeps = {
      backend: "api",
      generate: async (input) => {
        if (input.system?.startsWith("You write one multiple-choice question")) throw new Error("model 503");
        const r = await base.generate(input);
        const v = r.value as { mcqs?: { key: string; options: string[] }[] };
        for (const m of v.mcqs ?? []) {
          m.key = "zzzz";
          m.options = ["zzzz", ...m.options.slice(1)];
        }
        return r;
      },
    };
    const { t, fn } = engine(jobId, modelA);
    const run = await t.execute();
    const error = (run as { error?: Error }).error as Error;
    expect(error.message).toMatch(/^check-and-dedupe: /);
    await runOnFailure(fn, jobId, error);
    expect(await jobRow(jobId)).toEqual({ status: "failed", reason: "check-and-dedupe-failed" });
    expect(await ladderCount()).toBe(0);
  });

  test("save-ladder failing on every attempt: after the last retry the job fails save-ladder-failed, no ladder", async () => {
    const jobId = await newJob();
    await db.sql`CREATE OR REPLACE FUNCTION t008_reject_report() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'report write failed'; END $$`;
    await db.sql`CREATE TRIGGER t008_reject_report BEFORE INSERT ON generation_reports FOR EACH ROW EXECUTE FUNCTION t008_reject_report()`;
    try {
      const { t, fn } = engine(jobId, failingModelA());
      const run = await t.execute();
      const error = (run as { error?: Error }).error as Error;
      expect(error.message).toMatch(/^save-ladder: /);
      expect(await ladderCount()).toBe(0); // one transaction: no ladder row without its report
      await runOnFailure(fn, jobId, error);
      expect(await jobRow(jobId)).toEqual({ status: "failed", reason: "save-ladder-failed" });
    } finally {
      await db.sql`DROP TRIGGER t008_reject_report ON generation_reports`;
    }
  });
});
