// T009 AC 3, 4 and Success Criteria 3 to 5: step blind-solve between check-and-dedupe and save-ladder.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { InngestTestEngine } from "@inngest/test";
import { blindSolveLevels } from "../src/server/blind-solver.ts";
import type { GeneratedLevel } from "../src/server/check-and-dedupe.ts";
import { githubRepoClient } from "../src/server/github-repo.ts";
import {
  type CostEntry,
  createInngest,
  LADDER_GENERATE_EVENT,
  ladderGenerateFunction,
} from "../src/server/ladder-generate.ts";
import type { LevelChunk } from "../src/server/level-generator.ts";
import { migrateUp } from "../src/server/migrate.ts";
import { type Generate, type ModelADeps, ModelAFailedError, ModelAInvalidOutputError } from "../src/server/model-a.ts";
import { createTestDatabase } from "./support/db.ts";
import { type Fixture, fixtureFetch, loadFixture, V0_REPOS } from "./support/github-fixtures.ts";
import { drainInngestRuns } from "./support/inngest-drain.ts";
import { promptData, testModelA, testModelB, testReader } from "./support/mock-model.ts";

const usage = { model: "mock", inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 };

// --- blindSolveLevels with scripted models (no database) ---------------------------------------------------------

const CHUNK: LevelChunk = {
  id: 1,
  source: "core",
  path: "src/index.ts",
  startLine: 1,
  endLine: 3,
  text: "off removes a handler. on adds a handler. emit calls every handler. all is a wildcard.",
};
const mcq = (question: string, key = "off") => ({
  question,
  options: [key, "on", "emit", "all"]
    .filter((o, i, a) => a.indexOf(o) === i)
    .concat(["x1", "x2"])
    .slice(0, 4),
  key,
  chunkId: 1,
});
const level = (mcqs: ReturnType<typeof mcq>[]): GeneratedLevel => ({
  level: "L3",
  status: "generated",
  goal: "g",
  passTest: { kind: "k", description: "d" },
  cards: [],
  mcqs,
  dropped: [],
});

/** Model B that picks `pick(question, options)`; counts calls. */
function modelB(pick: (question: string, options: string[]) => string | Error) {
  const calls: string[] = [];
  const generate: Generate = async ({ schema, prompt }) => {
    const d = JSON.parse(prompt.split("\n")[1] as string) as { question: string; options: string[] };
    calls.push(d.question);
    const choice = pick(d.question, d.options);
    if (choice instanceof Error) throw choice;
    return { value: schema.parse({ answerIndex: d.options.indexOf(choice) }), usage };
  };
  return { generate, calls };
}
/** Model A that answers each regeneration with the next scripted question. */
function modelA(replacements: ReturnType<typeof mcq>[]) {
  let n = 0;
  const generate: Generate = async ({ schema }) => ({
    value: schema.parse({ mcq: replacements[Math.min(n++, replacements.length - 1)] }),
    usage,
  });
  return { generate, count: () => n };
}
const run = (levels: GeneratedLevel[], a: Generate, b: Generate, onUsageB?: (u: unknown) => void) =>
  blindSolveLevels({ levels, chunks: [CHUNK], generateA: a, generateB: b, dedupeJaccard: 0.8, onUsageB });

describe("blindSolveLevels (AC 3, AC 4)", () => {
  test("agreement keeps the MCQ with no model A call", async () => {
    const a = modelA([]);
    const b = modelB((_q, options) => options.find((o) => o === "off") as string);
    const { levels, results } = await run([level([mcq("Which removes?")])], a.generate, b.generate);
    expect((levels[0] as GeneratedLevel).mcqs).toHaveLength(1);
    expect(a.count()).toBe(0);
    expect(results).toEqual([expect.objectContaining({ outcome: "agree", regenerations: 0 })]);
    expect(results[0]?.seeds).toHaveLength(1);
  });

  test("model B disagrees 3 times in a row: model A regenerates twice, then the MCQ is dropped blind-solve-mismatch", async () => {
    const a = modelA([mcq("Which one removes a handler?"), mcq("Which of these removes handlers?")]);
    const b = modelB((_q, options) => options.find((o) => o !== "off") as string);
    const { levels, results } = await run([level([mcq("Which removes?")])], a.generate, b.generate);
    const l = levels[0] as GeneratedLevel;
    expect(l.mcqs).toHaveLength(0);
    expect(l.dropped).toEqual([{ item: mcq("Which removes?"), reason: "blind-solve-mismatch" }]);
    expect(a.count()).toBe(2);
    expect(b.calls).toHaveLength(3);
    expect(results[0]).toMatchObject({ outcome: "dropped", regenerations: 2 });
    expect(results[0]?.seeds).toHaveLength(3);
  });

  test("a regenerated version that model B agrees with replaces the MCQ", async () => {
    const a = modelA([mcq("Which method removes a handler from the emitter?")]);
    const b = modelB((q, options) =>
      q.startsWith("Which method") ? "off" : (options.find((o) => o !== "off") as string),
    );
    const { levels, results } = await run([level([mcq("Which removes?")])], a.generate, b.generate);
    expect((levels[0] as GeneratedLevel).mcqs.map((m) => m.question)).toEqual([
      "Which method removes a handler from the emitter?",
    ]);
    expect(results[0]).toMatchObject({ outcome: "regenerated", regenerations: 1 });
    expect(a.count()).toBe(1);
  });

  test("a replacement whose key fails the answer-key check is never blind-solved and uses up its attempt", async () => {
    const a = modelA([mcq("Which one removes a handler?", "zzz"), mcq("Which of these removes handlers?", "zzz")]);
    const b = modelB((_q, options) => options.find((o) => o !== "off") as string);
    const { levels } = await run([level([mcq("Which removes?")])], a.generate, b.generate);
    expect((levels[0] as GeneratedLevel).dropped.map((d) => d.reason)).toEqual(["blind-solve-mismatch"]);
    expect(a.count()).toBe(2);
    expect(b.calls).toHaveLength(1); // only the original was solved
  });

  test("a replacement that repeats another question of the ladder is not kept", async () => {
    const a = modelA([mcq("Which removes a handler?"), mcq("Which removes a handler?")]);
    const b = modelB((q, options) => (q === "Which removes?" ? (options.find((o) => o !== "off") as string) : "off"));
    const { levels } = await run(
      [level([mcq("Which removes?"), mcq("Which removes a handler?", "on")])],
      a.generate,
      b.generate,
    );
    expect((levels[0] as GeneratedLevel).dropped).toHaveLength(1);
  });

  test("model B answerIndex out of range or a model error: dropped, never kept (Success Criterion 4)", async () => {
    const bad: Generate = async ({ schema }) => {
      const r = schema.safeParse({ answerIndex: 7 });
      throw new ModelAInvalidOutputError(r.success ? "?" : (r.error.issues[0]?.message ?? "?"), usage);
    };
    const throwing: Generate = async () => {
      throw new ModelAFailedError("claude -p timeout");
    };
    for (const b of [bad, throwing]) {
      const a = modelA([mcq("Which one removes a handler?")]);
      const { levels, results } = await run([level([mcq("Which removes?")])], a.generate, b);
      const l = levels[0] as GeneratedLevel;
      expect(l.mcqs).toHaveLength(0);
      expect(l.dropped.map((d) => d.reason)).toEqual(["blind-solve-mismatch"]);
      expect(results[0]?.failure).toMatch(/model-a/);
    }
  });

  test("a model A failure during a regeneration spends the attempt and the MCQ is dropped", async () => {
    const a: Generate = async () => {
      throw new ModelAInvalidOutputError("not json");
    };
    const b = modelB((_q, options) => options.find((o) => o !== "off") as string);
    const { levels } = await run([level([mcq("Which removes?")])], a, b.generate);
    expect((levels[0] as GeneratedLevel).mcqs).toHaveLength(0);
  });

  test("every model B call is reported to onUsageB", async () => {
    const seen: unknown[] = [];
    const b = modelB((_q, options) => options.find((o) => o === "off") as string);
    await run([level([mcq("Which removes?")])], modelA([]).generate, b.generate, (u) => seen.push(u));
    expect(seen).toHaveLength(1);
  });
});

// --- the workflow end to end -------------------------------------------------------------------------------------

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

/** testModelA that also answers a regeneration (one MCQ citing the first chunk, a fresh question each time). */
function regeneratingModelA(): ModelADeps & { regenerations: () => number; generatorCalls: () => number } {
  const base = testModelA();
  let regen = 0;
  let gen = 0;
  return {
    backend: "api",
    regenerations: () => regen,
    generatorCalls: () => gen,
    generate: async (input) => {
      if (input.system?.startsWith("You write one multiple-choice question")) {
        const data = JSON.parse(input.prompt.split("\n")[1] as string) as { chunks: { id: number; text: string }[] };
        const first = data.chunks[0] as { id: number; text: string };
        const key = first.text.match(/[\p{L}\p{N}]+/u)?.[0] as string;
        regen++;
        return {
          value: input.schema.parse({
            mcq: {
              question: `Regenerated question number ${regen} about the repository?`,
              options: [key, "option b", "option c", "option d"],
              key,
              chunkId: first.id,
            },
          }),
          usage,
        };
      }
      if (promptData(input.prompt)?.level) gen++;
      return await base.generate(input);
    },
  };
}
/** testModelB that never picks the key (the first word of the chunk). */
function disagreeingModelB(): ModelADeps {
  const agree = testModelB();
  return {
    backend: "claude-code",
    generate: async (input) => {
      const r = await agree.generate(input);
      const v = r.value as { answerIndex: number };
      return { ...r, value: { answerIndex: (v.answerIndex + 1) % 4 } as never };
    },
  };
}

function engine(jobId: string, a: ModelADeps, b: ModelADeps, costs: CostEntry[] = []) {
  const gh = fixtureFetch(fixtures, (path) => {
    const m = path.match(/^\/repos\/developit\/mitt\/contents\/([^?]+)\?ref=/);
    return m ? new Response(fileText(decodeURIComponent(m[1] as string))) : undefined;
  });
  const fn = ladderGenerateFunction(createInngest(), {
    sql: db.sql,
    github: githubRepoClient({ baseUrl: "https://api.github.com", token: "t", fetch: gh.impl }),
    reader: { ...testReader(), logCost: (e) => costs.push(e) },
    modelA: a,
    modelB: b,
  });
  return new InngestTestEngine({ function: fn, events: [{ name: LADDER_GENERATE_EVENT, data: { ...MITT, jobId } }] });
}

describe("step blind-solve in ladder-generate (AC 3, AC 4, Success Criterion 5)", () => {
  test("order: check-and-dedupe -> blind-solve -> save-ladder; agreeing model B keeps the ladder, no regeneration", async () => {
    const jobId = await newJob();
    const a = regeneratingModelA();
    const costs: CostEntry[] = [];
    const { result, ctx } = await engine(jobId, a, testModelB(), costs).execute();
    expect(ctx.step.run.mock.calls.map((c) => c[0]).slice(-3)).toEqual([
      "check-and-dedupe",
      "blind-solve",
      "save-ladder",
    ]);
    expect(result).toMatchObject({ status: "done" });
    expect(a.regenerations()).toBe(0);
    const bCosts = costs.filter((c) => c.step === "blind-solve");
    expect(bCosts.length).toBeGreaterThan(0);
    expect(bCosts.every((c) => c.model === "test-model-b" && c.backend === "api")).toBe(true);
    const blind = (result as { blindSolve: { outcome: string }[] }).blindSolve;
    expect(blind.length).toBeGreaterThan(0);
    expect(blind.every((r) => r.outcome === "agree")).toBe(true);
  });

  test("model B always disagrees: 2 regenerations by model A, MCQ dropped blind-solve-mismatch and counted in the report", async () => {
    const jobId = await newJob();
    const a = regeneratingModelA();
    const costs: CostEntry[] = [];
    const { result } = await engine(jobId, a, disagreeingModelB(), costs).execute();
    expect(result).toMatchObject({ status: "done" });
    const [ladder] = await db.sql`SELECT id::text AS id FROM ladders`;
    const [{ report }] = await db.sql`SELECT report FROM generation_reports WHERE ladder_id = ${ladder.id}`;
    const total = report.levels.reduce(
      (n: number, l: { dropped: Record<string, number> }) => n + (l.dropped["blind-solve-mismatch"] ?? 0),
      0,
    );
    expect(total).toBeGreaterThan(0);
    // (@inngest/test re-runs handlers, so assert the per-item counts the step recorded, not model A's call total.)
    const blind = (result as { blindSolve: { outcome: string; regenerations: number; seeds: number[] }[] }).blindSolve;
    expect(blind.length).toBe(total);
    for (const r of blind)
      expect(r).toMatchObject({ outcome: "dropped", regenerations: 2, seeds: [r.seeds[0], r.seeds[1], r.seeds[2]] });
    expect((await db.sql`SELECT count(*)::int AS n FROM mcqs`)[0].n).toBe(0);
    // model A's regenerations are logged under the same step, with model A's back end
    expect(costs.filter((c) => c.step === "blind-solve").map((c) => c.backend)).toContain("claude-code");
  });

  test("a retry of blind-solve re-runs no generator and no earlier step (memoized results)", async () => {
    const jobId = await newJob();
    const first = await engine(jobId, regeneratingModelA(), testModelB()).execute();
    const results = first.ctx.step.run.mock.results;
    const ran = first.ctx.step.run.mock.calls.map((c) => c[0] as string);
    const ids = ran.slice(0, ran.indexOf("blind-solve"));
    const memo = await Promise.all(
      ids.map(async (id) => {
        const value = await (results[ran.indexOf(id)] as { value?: unknown }).value;
        return { id, handler: async () => value };
      }),
    );
    expect(ids).toContain("check-and-dedupe");
    await db.sql`UPDATE generation_jobs SET status = 'mapped' WHERE id = ${jobId}`;
    await db.sql`TRUNCATE ladders CASCADE`;
    const retryA = regeneratingModelA();
    const retry = await engine(jobId, retryA, testModelB()).execute({ steps: memo });
    expect(retry.result).toMatchObject({ status: "done" });
    expect(retryA.generatorCalls()).toBe(0);
    expect(retryA.regenerations()).toBe(0);
  });

  test("a failure a retry cannot help (claude not installed for model B) fails the job blind-solve-failed", async () => {
    const { ModelANotInstalledError } = await import("../src/server/model-a.ts");
    const jobId = await newJob();
    const b: ModelADeps = {
      backend: "claude-code",
      generate: async () => {
        throw new ModelANotInstalledError("no claude");
      },
    };
    await engine(jobId, regeneratingModelA(), b).execute();
    const [job] = await db.sql`SELECT status, reason FROM generation_jobs WHERE id = ${jobId}`;
    expect(job).toEqual({ status: "failed", reason: "blind-solve-failed" });
    expect((await db.sql`SELECT count(*)::int AS n FROM ladders`)[0].n).toBe(0);
  });
});
