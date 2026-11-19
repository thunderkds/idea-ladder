// T007 AC 3: Inngest step map-concepts after pick-core-files (job statuses, stored repo_concepts, cost, retry, failure).
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InngestTestEngine } from "@inngest/test";
import { APICallError } from "ai";
import { githubRepoClient } from "../src/server/github-repo.ts";
import {
  type CostEntry,
  createInngest,
  LADDER_GENERATE_EVENT,
  ladderGenerateFunction,
} from "../src/server/ladder-generate.ts";
import { migrateUp } from "../src/server/migrate.ts";
import { createModelA, type ModelADeps, ModelAFailedError, ModelANotInstalledError } from "../src/server/model-a.ts";
import { createTestDatabase } from "./support/db.ts";
import { type Fixture, fixtureFetch, loadFixture, V0_REPOS } from "./support/github-fixtures.ts";
import { mockEmbedder } from "./support/mock-embedder.ts";
import { TEST_CONCEPTS, testReader } from "./support/mock-model.ts";

let db: Awaited<ReturnType<typeof createTestDatabase>>;
let fixtures: Fixture[];
beforeAll(async () => {
  db = await createTestDatabase();
  await migrateUp(db.sql);
  fixtures = [await loadFixture("lukeed/dset")];
});
afterAll(async () => {
  await db.drop();
});
beforeEach(async () => {
  await db.sql`TRUNCATE generation_jobs, repo_snapshots CASCADE`;
});

const DSET = { repo: "lukeed/dset", sha: V0_REPOS["lukeed/dset"] };
const newJob = async () =>
  (
    await db.sql`
    INSERT INTO generation_jobs (repo_full_name, commit_sha) VALUES (${DSET.repo}, ${DSET.sha}) RETURNING id::text`
  )[0].id as string;
const jobRow = async (id: string) =>
  (await db.sql`SELECT status, reason FROM generation_jobs WHERE id = ${id}`)[0] as {
    status: string;
    reason: string | null;
  };
const conceptRows = async () =>
  await db.sql`SELECT position, name, slug, reason, basis FROM repo_concepts WHERE repo_full_name = ${DSET.repo} AND commit_sha = ${DSET.sha} ORDER BY position`;

function engine(jobId: string, modelA: ModelADeps, costs: CostEntry[] = [], reader = testReader()) {
  const gh = fixtureFetch(fixtures, () => undefined);
  const fn = ladderGenerateFunction(createInngest(), {
    embedder: mockEmbedder(),
    sql: db.sql,
    github: githubRepoClient({ baseUrl: "https://api.github.com", token: "t", fetch: gh.impl }),
    reader: { ...reader, logCost: (e) => costs.push(e) },
    modelA,
  });
  return new InngestTestEngine({ function: fn, events: [{ name: LADDER_GENERATE_EVENT, data: { ...DSET, jobId } }] });
}

describe("Inngest step map-concepts (AC 3)", () => {
  test("runs after pick-core-files: job picked -> mapping -> mapped, concepts stored, cost logged, fallback flag carried", async () => {
    const jobId = await newJob();
    const costs: CostEntry[] = [];
    const seenStatus: string[] = [];
    const prompts: string[] = [];
    const modelA: ModelADeps = {
      backend: "api",
      generate: async ({ schema, prompt }) => {
        seenStatus.push((await jobRow(jobId)).status);
        prompts.push(prompt);
        return {
          value: schema.parse({ concepts: TEST_CONCEPTS }),
          usage: { model: "test-model", inputTokens: 7, outputTokens: 3, cachedInputTokens: 0 },
        };
      },
    };
    const { result, ctx } = await engine(jobId, modelA, costs).executeStep("map-concepts");
    expect(ctx.step.run.mock.calls.map((c) => c[0])).toEqual(["fetch-repo", "pick-core-files", "map-concepts"]);
    expect(result).toMatchObject({ status: "mapped", fallbackToConcepts: false });
    expect(seenStatus).toEqual(["mapping"]);
    expect((await jobRow(jobId)).status).toBe("mapped");
    expect(await conceptRows()).toEqual(
      TEST_CONCEPTS.map((c, i) => ({
        position: i + 1,
        name: c.name,
        slug: c.name.toLowerCase().replace(" ", "-"),
        reason: c.reason,
        basis: c.basis,
      })),
    );
    const [fb] =
      await db.sql`SELECT fallback_to_concepts AS f FROM repo_confidence WHERE repo_full_name = ${DSET.repo}`;
    expect(JSON.stringify((result as { fallbackToConcepts: unknown }).fallbackToConcepts)).toBe(
      JSON.stringify(fb.f === true),
    );
    // the prompt lists the stored core files in rank order
    const picked = await db.sql`SELECT path FROM core_files WHERE repo_full_name = ${DSET.repo} ORDER BY rank`;
    const order = picked.map((r: { path: string }) => prompts[0]?.indexOf(JSON.stringify(r.path)) ?? -1);
    expect(order.every((i: number) => i >= 0)).toBe(true);
    expect([...order].sort((a: number, b: number) => a - b)).toEqual(order);
    const mapCosts = costs.filter((c) => c.step === "map-concepts");
    expect(mapCosts).toEqual([
      {
        jobId,
        repo: DSET.repo,
        sha: DSET.sha,
        step: "map-concepts",
        backend: "api",
        model: "test-model",
        inputTokens: 7,
        outputTokens: 3,
        cachedInputTokens: 0,
      },
    ]);
  });

  test("mapper-invalid-output fails a job in mapping", async () => {
    const jobId = await newJob();
    const modelA: ModelADeps = {
      backend: "api",
      generate: async ({ schema }) => ({
        value: schema.parse({ concepts: TEST_CONCEPTS.map((c) => ({ ...c, basis: ["src/nope.ts"] })) }),
        usage: { model: "test-model", inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
      }),
    };
    const { result } = await engine(jobId, modelA).execute();
    expect(result).toMatchObject({ status: "failed", reason: "mapper-invalid-output" });
    expect(await jobRow(jobId)).toEqual({ status: "failed", reason: "mapper-invalid-output" });
    expect(await conceptRows()).toEqual([]);
  });

  test("a transient model error retries only map-concepts: earlier steps are memoized, picks not re-run", async () => {
    const jobId = await newJob();
    let n = 0;
    const modelA: ModelADeps = {
      backend: "api",
      generate: async ({ schema }) => {
        if (n++ === 0) throw new ModelAFailedError("timeout");
        return {
          value: schema.parse({ concepts: TEST_CONCEPTS }),
          usage: { model: "test-model", inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
        };
      },
    };
    const t = engine(jobId, modelA);
    const first = await t.execute();
    expect((first as { error?: Error }).error?.message).toMatch(/timeout/);
    expect((await jobRow(jobId)).status).toBe("mapping");
    const results = first.ctx.step.run.mock.results;
    const fetched = await (results[0] as { value?: unknown }).value;
    const picked = await (results[1] as { value?: unknown }).value;
    const retry = await t.executeStep("map-concepts", {
      steps: [
        { id: "fetch-repo", handler: async () => fetched },
        { id: "pick-core-files", handler: async () => picked },
      ],
    });
    expect(retry.result).toMatchObject({ status: "mapped" });
    expect(n).toBe(2);
    expect((await conceptRows()).length).toBe(3);
  });

  test("a second job for the same repo + SHA reuses the stored concepts: no model call", async () => {
    const first = await newJob();
    const modelA = (calls: { n: number }): ModelADeps => ({
      backend: "api",
      generate: async ({ schema }) => {
        calls.n++;
        return {
          value: schema.parse({ concepts: TEST_CONCEPTS }),
          usage: { model: "test-model", inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
        };
      },
    });
    const c1 = { n: 0 };
    await engine(first, modelA(c1)).execute();
    await db.sql`UPDATE generation_jobs SET status = 'failed' WHERE id = ${first}`;
    const second = await newJob();
    const c2 = { n: 0 };
    const { result } = await engine(second, modelA(c2)).executeStep("map-concepts");
    expect(c1.n).toBe(1);
    expect(c2.n).toBe(0);
    expect(result).toMatchObject({ status: "mapped" });
    expect((await conceptRows()).length).toBe(3);
  });
});

describe("Inngest step map-concepts on the claude-code back end", () => {
  test("fake claude: concepts stored, cost logged with backend claude-code", async () => {
    const rec = await mkdtemp(join(tmpdir(), "il-fake-claude-"));
    try {
      const bin = join(rec, "claude");
      const fake = join(import.meta.dir, "support", "fake-claude.ts");
      await writeFile(bin, `#!/bin/sh\nexec "${process.execPath}" "${fake}" "${rec}" "$@"\n`);
      await chmod(bin, 0o755);
      const out = {
        is_error: false,
        structured_output: { concepts: TEST_CONCEPTS },
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      };
      await writeFile(join(rec, "replies.json"), JSON.stringify([{ stdout: JSON.stringify(out) }]));
      const jobId = await newJob();
      const costs: CostEntry[] = [];
      const { result } = await engine(
        jobId,
        createModelA({ backend: "claude-code", claudeBin: bin }),
        costs,
      ).executeStep("map-concepts");
      expect(result).toMatchObject({ status: "mapped" });
      expect((await conceptRows()).length).toBe(3);
      expect(costs.filter((c) => c.step === "map-concepts")).toEqual([
        {
          jobId,
          repo: DSET.repo,
          sha: DSET.sha,
          step: "map-concepts",
          backend: "claude-code",
          model: "claude-code",
          inputTokens: 10,
          outputTokens: 5,
          cachedInputTokens: 0,
        },
      ]);
    } finally {
      await rm(rec, { recursive: true, force: true });
    }
  });

  describe("failure paths (AC 3)", () => {
    const failing = (error: Error, calls: { n: number }): ModelADeps => ({
      backend: "api",
      generate: async () => {
        calls.n++;
        throw error;
      },
    });
    const failAfterRetries = async (jobId: string, error: Error) => {
      const handler = ladderFn(jobId).opts.onFailure as unknown as (ctx: {
        event: unknown;
        error: Error;
      }) => Promise<unknown>;
      await handler({
        event: {
          name: "inngest/function.failed",
          data: { event: { name: LADDER_GENERATE_EVENT, data: { ...DSET, jobId } } },
        },
        error,
      });
    };
    const ladderFn = (jobId: string) =>
      (engine(jobId, failing(new Error("x"), { n: 0 })) as unknown as { options: { function: never } }).options
        .function as ReturnType<typeof ladderGenerateFunction>;

    test("generate always throws ModelAFailedError: job stays mapping, onFailure after retries -> failed / mapper-error", async () => {
      const jobId = await newJob();
      const error = new ModelAFailedError("claude timed out");
      const run = await engine(jobId, failing(error, { n: 0 })).execute();
      expect((run as { error?: Error }).error?.message).toMatch(/claude timed out/);
      expect((await jobRow(jobId)).status).toBe("mapping");
      await failAfterRetries(jobId, error);
      expect(await jobRow(jobId)).toEqual({ status: "failed", reason: "mapper-error" });
    });

    test("generate throws ModelANotInstalledError: failed / model-a-not-installed at once", async () => {
      const jobId = await newJob();
      const { result } = await engine(
        jobId,
        failing(new ModelANotInstalledError("claude not found"), { n: 0 }),
      ).execute();
      expect(result).toMatchObject({ status: "failed", reason: "model-a-not-installed" });
      expect(await jobRow(jobId)).toEqual({ status: "failed", reason: "model-a-not-installed" });
    });

    test("generate throws a non-retryable APICallError (401): failed / mapper-error with exactly 1 generate call", async () => {
      const jobId = await newJob();
      const calls = { n: 0 };
      const error = new APICallError({
        message: "invalid x-api-key",
        url: "https://api.anthropic.com/v1/messages",
        requestBodyValues: {},
        statusCode: 401,
        isRetryable: false,
      });
      const { result } = await engine(jobId, failing(error, calls)).execute();
      expect(result).toMatchObject({ status: "failed", reason: "mapper-error" });
      expect(await jobRow(jobId)).toEqual({ status: "failed", reason: "mapper-error" });
      expect(calls.n).toBe(1);
    });
  });
});
