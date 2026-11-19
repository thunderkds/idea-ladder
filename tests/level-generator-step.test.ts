// T008 (8b) AC 2 / AC 8 / Success Criteria 6 (first half) and 7: steps generate-level-L0..L4 after chunk.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { InngestTestEngine } from "@inngest/test";
import { githubRepoClient } from "../src/server/github-repo.ts";
import {
  type CostEntry,
  createInngest,
  LADDER_GENERATE_EVENT,
  ladderGenerateFunction,
} from "../src/server/ladder-generate.ts";
import { migrateUp } from "../src/server/migrate.ts";
import { type ModelADeps, ModelAFailedError, ModelANotInstalledError } from "../src/server/model-a.ts";
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
  await db.sql`TRUNCATE generation_jobs, repo_snapshots CASCADE`;
});

const MITT = { repo: "developit/mitt", sha: V0_REPOS["developit/mitt"] };
const LEVEL_STEPS = ["L0", "L1", "L2", "L3", "L4"].map((l) => `generate-level-${l}`);
const newJob = async () =>
  (
    await db.sql`
    INSERT INTO generation_jobs (repo_full_name, commit_sha) VALUES (${MITT.repo}, ${MITT.sha}) RETURNING id::text`
  )[0].id as string;
const jobRow = async (id: string) =>
  (await db.sql`SELECT status, reason FROM generation_jobs WHERE id = ${id}`)[0] as { status: string; reason: string };
const fileText = (path: string) => Array.from({ length: 120 }, (_, i) => `${path} line ${i + 1}`).join("\n");

/**
 * testModelA, recording each level generator's prompt data; `fail(level)` may throw for a level.
 * Note: @inngest/test re-runs the handler of a parallel step that is not memoized yet on each re-execution of the
 * function (real Inngest runs each planned step once), so per-level call counts are only exact in a retry run whose
 * other steps are given as memoized `steps`.
 */
function levelModelA(fail?: (level: string) => Error | undefined) {
  const base = testModelA();
  const calls: Record<string, { level: string; chunks: { id: number }[] }[]> = {};
  const modelA: ModelADeps = {
    backend: "api",
    generate: async (input) => {
      const data = promptData(input.prompt);
      if (data?.level) {
        const list = calls[data.level] ?? [];
        calls[data.level] = list;
        list.push(data);
        const err = fail?.(data.level);
        if (err) throw err;
      }
      return await base.generate(input);
    },
  };
  return { modelA, calls };
}

function engine(jobId: string, modelA: ModelADeps, costs: CostEntry[] = []) {
  const gh = fixtureFetch(fixtures, (path) => {
    const m = path.match(/^\/repos\/developit\/mitt\/contents\/([^?]+)\?ref=/);
    return m ? new Response(fileText(decodeURIComponent(m[1] as string))) : undefined;
  });
  const fn = ladderGenerateFunction(createInngest(), {
    sql: db.sql,
    github: githubRepoClient({ baseUrl: "https://api.github.com", token: "t", fetch: gh.impl }),
    reader: { ...testReader(), logCost: (e) => costs.push(e) },
    modelA,
    modelB: testModelB(),
  });
  const t = new InngestTestEngine({
    function: fn,
    events: [{ name: LADDER_GENERATE_EVENT, data: { ...MITT, jobId } }],
  });
  return { t, fn };
}
const chunkIds = async (sources: string[]) =>
  (
    await db.sql`SELECT id::int AS id FROM chunks WHERE repo_full_name = ${MITT.repo} AND commit_sha = ${MITT.sha}
      AND source IN ${db.sql(sources)} ORDER BY id`
  ).map((r: { id: number }) => r.id);

describe("Inngest steps generate-level-L0..L4 (AC 2, AC 3)", () => {
  test("five generator steps after chunk, each grounded in its own level's chunks; cost per step; nothing stored", async () => {
    const jobId = await newJob();
    const { modelA, calls } = levelModelA();
    const costs: CostEntry[] = [];
    const { result, ctx } = await engine(jobId, modelA, costs).t.execute();
    expect(ctx.step.run.mock.calls.map((c) => c[0])).toEqual([
      "fetch-repo",
      "pick-core-files",
      "map-concepts",
      "chunk",
      ...LEVEL_STEPS,
      "check-and-dedupe",
      "save-ladder",
    ]);
    const sources: Record<string, string[]> = {
      L0: ["readme", "dep"],
      L1: ["readme", "docs"],
      L2: ["core"],
      L3: ["core"],
      L4: ["core"],
    };
    for (const [level, src] of Object.entries(sources)) {
      const ids = await chunkIds(src);
      expect(ids.length).toBeGreaterThan(0);
      expect(calls[level]?.length).toBeGreaterThan(0);
      for (const call of calls[level] ?? []) expect(call.chunks.map((c) => c.id)).toEqual(ids);
    }
    const levels = (result as { levels: { level: string; status: string; passTest: { kind: string } }[] }).levels;
    expect(levels.map((l) => [l.level, l.status, l.passTest.kind])).toEqual([
      ["L0", "generated", "concept-mcq"],
      ["L1", "generated", "run-log-and-explanation"],
      ["L2", "generated", "branch-diff-and-diff-questions"],
      ["L3", "generated", "verified-mcq"],
      ["L4", "generated", "repo-or-merged-pr"],
    ]);
    const levelCosts = costs.filter((c) => c.step.startsWith("generate-level-"));
    expect([...new Set(levelCosts.map((c) => `${c.step} ${c.backend}`))].sort()).toEqual(
      LEVEL_STEPS.map((s) => `${s} api`),
    );
    // Nothing is stored before save-ladder; it writes one ladder and sets the job done (tests/save-ladder.test.ts).
    expect((await jobRow(jobId)).status).toBe("done");
    expect((await db.sql`SELECT count(*)::int AS n FROM ladders`)[0].n).toBe(1);
  });

  test("Success Criterion 7: fallbackToConcepts -> only L0 is generated, L1-L4 concept-only-skipped", async () => {
    const first = await newJob();
    await engine(first, levelModelA().modelA).t.execute();
    await drainInngestRuns(); // the first run's stray steps end before the job and the confidence change
    await db.sql`UPDATE generation_jobs SET status = 'failed' WHERE id = ${first}`;
    await db.sql`UPDATE repo_confidence SET fallback_to_concepts = true WHERE repo_full_name = ${MITT.repo}`;
    const jobId = await newJob();
    const { modelA, calls } = levelModelA();
    const { result, ctx } = await engine(jobId, modelA).t.execute();
    expect(ctx.step.run.mock.calls.map((c) => c[0]).filter((s) => String(s).startsWith("generate-level-"))).toEqual([
      "generate-level-L0",
    ]);
    expect(Object.keys(calls)).toEqual(["L0"]);
    const levels = (result as { levels: { level: string; kind?: string }[] }).levels;
    expect(levels.slice(1)).toEqual(
      ["L1", "L2", "L3", "L4"].map((level) => ({ level, status: "skipped", kind: "concept-only-skipped" })),
    );
  });
});

describe("retry and failure (NFR-005, AC 8)", () => {
  test("Success Criterion 6 (first half): generate-level-L2 throws once -> only that step is retried", async () => {
    const jobId = await newJob();
    const { modelA } = levelModelA((level) => (level === "L2" ? new ModelAFailedError("timeout") : undefined));
    const { t } = engine(jobId, modelA);
    const first = await t.execute();
    expect((first as { error?: Error }).error?.message).toMatch(/generate-level-L2: model-a-failed: timeout/);
    expect((await jobRow(jobId)).status).toBe("mapped"); // not failed: Inngest retries the step
    // Inngest memoizes every step that completed; the retry re-runs only the failed one. The engine leaves the
    // parallel steps of a failed run pending (and caches step results per engine), so the retry uses a fresh engine
    // with the other level steps memoized as marker results.
    const results = first.ctx.step.run.mock.results;
    const ran = first.ctx.step.run.mock.calls.map((c) => c[0]);
    const memo = await Promise.all(
      ["fetch-repo", "pick-core-files", "map-concepts", "chunk"].map(async (id) => {
        const value = await (results[ran.indexOf(id)] as { value?: unknown }).value;
        return { id, handler: async () => value };
      }),
    );
    const others: Record<string, unknown> = {};
    for (const id of LEVEL_STEPS.filter((s) => s !== "generate-level-L2")) {
      others[id] = {
        ...{ goal: "g", passTest: { kind: "k", description: "d" }, cards: [], mcqs: [], dropped: [] },
        level: id.slice(-2),
        status: "generated",
        memoized: true,
      };
      memo.push({ id, handler: async () => others[id] });
    }
    // The retry gets its own model A record: handlers the first engine still runs in the background do not count.
    const { modelA: retryModelA, calls } = levelModelA();
    const retry = await engine(jobId, retryModelA).t.execute({ steps: memo });
    const levels = (retry.result as { levels: { level: string; status: string }[] }).levels;
    expect(levels.map((l) => l.status)).toEqual(Array(5).fill("generated"));
    for (const l of levels) if (l.level !== "L2") expect(l).toEqual(others[`generate-level-${l.level}`] as never);
    // The retry re-ran only generate-level-L2; every other step kept its first result.
    expect(Object.keys(calls)).toEqual(["L2"]);
    expect(calls.L2).toHaveLength(1);
  });

  test("a generator step that fails on every attempt: after the retries onFailure fails the job generate-level-L3-failed", async () => {
    const jobId = await newJob();
    const { modelA } = levelModelA((level) => (level === "L3" ? new ModelAFailedError("timeout") : undefined));
    const { t, fn } = engine(jobId, modelA);
    const run = await t.execute();
    const error = (run as { error?: Error }).error as Error;
    expect(error.message).toMatch(/^generate-level-L3: /);
    expect((await jobRow(jobId)).status).toBe("mapped");
    expect(fn.opts.retries).toBe(3);
    const onFailure = fn.opts.onFailure as unknown as (ctx: { event: unknown; error: Error }) => Promise<unknown>;
    await onFailure({
      event: {
        name: "inngest/function.failed",
        data: { event: { name: LADDER_GENERATE_EVENT, data: { ...MITT, jobId } } },
      },
      error,
    });
    expect(await jobRow(jobId)).toEqual({ status: "failed", reason: "generate-level-L3-failed" });
  });

  test("a failure a retry cannot help (claude not installed) fails the job generate-level-L1-failed at once", async () => {
    const jobId = await newJob();
    const { modelA } = levelModelA((level) => (level === "L1" ? new ModelANotInstalledError("no claude") : undefined));
    const { result } = await engine(jobId, modelA).t.execute();
    // (The engine may re-run the L1 handler after the job failed, which then answers job-failed: assert the job row.)
    expect(result).toMatchObject({ status: "failed" });
    expect(await jobRow(jobId)).toEqual({ status: "failed", reason: "generate-level-L1-failed" });
  });

  test("check-and-dedupe after the generator steps: per-level kept items and drops, its cost under its own step", async () => {
    const jobId = await newJob();
    const { modelA, calls } = levelModelA();
    const costs: CostEntry[] = [];
    const { result } = await engine(jobId, modelA, costs).t.execute();
    const checked = (
      result as {
        checked: {
          level: string;
          status: string;
          cards: unknown[];
          mcqs: { key: string }[];
          dropped: { reason: string }[];
          passTest: { kind: string };
        }[];
      }
    ).checked;
    expect(checked.map((l) => [l.level, l.status, l.passTest.kind])).toEqual([
      ["L0", "generated", "concept-mcq"],
      ["L1", "generated", "run-log-and-explanation"],
      ["L2", "generated", "branch-diff-and-diff-questions"],
      ["L3", "generated", "verified-mcq"],
      ["L4", "generated", "repo-or-merged-pr"],
    ]);
    // testModelA answers the same card and question at every level: L0 keeps them, the rest are near-duplicates.
    expect(checked.map((l) => [l.cards.length, l.mcqs.length])).toEqual([
      [1, 1],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
    for (const l of checked.slice(1)) expect(l.dropped.map((d) => d.reason)).toEqual(["duplicate", "duplicate"]);
    expect(checked[0]?.dropped).toEqual([]);
    for (const level of ["L0", "L1", "L2", "L3", "L4"]) expect(calls[level]?.length).toBeGreaterThan(0);
    // Nothing is stored before save-ladder; it writes one ladder and sets the job done (tests/save-ladder.test.ts).
    expect((await jobRow(jobId)).status).toBe("done");
    expect((await db.sql`SELECT count(*)::int AS n FROM ladders`)[0].n).toBe(1);
  });
});
