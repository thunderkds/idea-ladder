import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InngestTestEngine } from "@inngest/test";
import { APICallError } from "ai";
import { type GithubRepoClient, githubRepoClient } from "../src/server/github-repo.ts";
import {
  type CostEntry,
  createInngest,
  LADDER_GENERATE_EVENT,
  ladderGenerateFunction,
} from "../src/server/ladder-generate.ts";
import { migrateUp } from "../src/server/migrate.ts";
import { createTestDatabase } from "./support/db.ts";
import { type Fixture, fixtureFetch, loadFixture, V0_REPOS } from "./support/github-fixtures.ts";
import { answer, type Reply, scriptedModel, testModelA } from "./support/mock-model.ts";

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
const INDEX_JS = "export function dset(obj, keys, val) { /* ... */ }\n";
const PICKS = [
  { path: "src/index.js", reason: "the whole library: dset walks the keys and assigns" },
  { path: "src/merge.js", reason: "the merge variant" },
  { path: "package.json", reason: "exports map: which file is the entry" },
];

async function newJob(): Promise<string> {
  const [job] = await db.sql`
    INSERT INTO generation_jobs (repo_full_name, commit_sha) VALUES (${DSET.repo}, ${DSET.sha}) RETURNING id::text`;
  return job.id;
}
const jobStatus = async (id: string) =>
  ((await db.sql`SELECT status, reason FROM generation_jobs WHERE id = ${id}`)[0] ?? {}) as {
    status: string;
    reason: string | null;
  };

function engine(
  jobId: string,
  script: (call: number) => Reply,
  wrap: (g: GithubRepoClient) => GithubRepoClient = (g) => g,
) {
  const gh = fixtureFetch(fixtures, (path) =>
    path.startsWith("/repos/lukeed/dset/contents/src/index.js?ref=")
      ? new Response(INDEX_JS, { headers: { "x-ratelimit-remaining": "4999" } })
      : undefined,
  );
  const github = wrap(githubRepoClient({ baseUrl: "https://api.github.com", token: "t", fetch: gh.impl }));
  const model = scriptedModel(script);
  const costs: CostEntry[] = [];
  const statuses: string[] = [];
  const fn = ladderGenerateFunction(createInngest(), {
    sql: db.sql,
    github,
    modelA: testModelA(),
    reader: {
      model,
      limits: { maxSteps: 15, tokenBudget: 80_000 },
      logCost: (e) => {
        costs.push(e);
        void jobStatus(jobId).then((r) => statuses.push(r.status));
      },
    },
  });
  const t = new InngestTestEngine({
    function: fn,
    events: [{ name: LADDER_GENERATE_EVENT, data: { ...DSET, jobId } }],
  });
  return { t, gh, model, costs, statuses, fn };
}

const happy = (call: number): Reply =>
  call === 0 ? { tools: [{ name: "read", input: { path: "src/index.js" } }] } : { text: answer(PICKS) };
const coreRows = async () =>
  await db.sql`SELECT rank, path, reason FROM core_files WHERE repo_full_name = ${DSET.repo} AND commit_sha = ${DSET.sha} ORDER BY rank`;

describe("Inngest step pick-core-files (AC 5, AC 6)", () => {
  test("runs after fetch-repo, stores ranked core files, job picking -> picked, one cost line per model call", async () => {
    const jobId = await newJob();
    const { t, gh, costs, statuses } = engine(jobId, happy);
    const { result, ctx } = await t.executeStep("map-concepts");
    expect(ctx.step.run.mock.calls.map((c) => c[0])).toEqual(["fetch-repo", "pick-core-files", "map-concepts"]);
    expect(result).toMatchObject({ status: "mapped", coreFiles: PICKS });
    expect(await coreRows()).toEqual(PICKS.map((p, i) => ({ rank: i + 1, ...p })));
    expect((await jobStatus(jobId)).status).toBe("mapped");
    await Bun.sleep(20);
    expect(statuses).toEqual(["picking", "picking", "mapping"]); // the last entry is the map-concepts cost line
    // AC 6: every model call -> logCost with the step name, model id and the SDK's token usage
    expect(costs.filter((c) => c.step === "pick-core-files")).toEqual(
      [0, 1].map(() => ({
        jobId,
        repo: DSET.repo,
        sha: DSET.sha,
        step: "pick-core-files",
        backend: "api",
        model: "test-model",
        inputTokens: 100,
        outputTokens: 10,
        cachedInputTokens: 0,
      })),
    );
    // the read went to the contents API at the pinned SHA and into the cache
    expect(gh.calls.filter((p) => p.includes("/contents/"))).toEqual([
      `/repos/lukeed/dset/contents/src/index.js?ref=${DSET.sha}`,
    ]);
    const cache = await db.sql`SELECT path, content FROM repo_file_cache`;
    expect(cache).toEqual([{ path: "src/index.js", content: INDEX_JS }]);
  });

  test("pick-core-files throws once (model 529): the retry re-runs only pick-core-files; rows written; file read once", async () => {
    const jobId = await newJob();
    let calls = 0;
    const { t, gh } = engine(jobId, () => {
      const n = calls++;
      if (n === 0) return { tools: [{ name: "read", input: { path: "src/index.js" } }] };
      if (n === 1) return { error: Object.assign(new Error("Overloaded"), { statusCode: 529 }) };
      return n === 2 ? { tools: [{ name: "read", input: { path: "src/index.js" } }] } : { text: answer(PICKS) };
    });
    const first = await t.execute();
    expect((first as { error?: Error }).error?.message).toMatch(/Overloaded/);
    expect((await jobStatus(jobId)).status).toBe("picking");
    expect((await coreRows()).length).toBe(0);
    const fetchCalls = gh.calls.filter((p) => !p.includes("/contents/")).length;

    // Inngest memoizes a finished step: the retry gets fetch-repo's stored result, never runs it again.
    // InngestTestEngine does not keep state between execute() calls, so the stored result is given here.
    const memoized = (first.ctx.step.run.mock.results[0] as { value?: unknown } | undefined)?.value;
    expect(await memoized).toMatchObject({ status: "fetched" });
    const retry = await t.executeStep("map-concepts", {
      steps: [{ id: "fetch-repo", handler: async () => await memoized }],
    });
    expect(retry.result).toMatchObject({ status: "mapped" });
    expect(gh.calls.filter((p) => !p.includes("/contents/")).length).toBe(fetchCalls); // fetch-repo not re-run
    expect(gh.calls.filter((p) => p.includes("/contents/")).length).toBe(1); // second read served from the cache
    expect((await coreRows()).map((r: { path: string }) => r.path)).toEqual(PICKS.map((p) => p.path));
    expect((await jobStatus(jobId)).status).toBe("mapped");
  });

  test("fewer than 3 valid paths after the repair -> job failed / reader-invalid-output, not retried, no rows", async () => {
    const jobId = await newJob();
    const { t, model } = engine(jobId, () => ({ text: answer([{ path: "src/index.js" }, { path: "src/nope.js" }]) }));
    const { result } = await t.execute();
    expect(result).toMatchObject({ status: "failed", reason: "reader-invalid-output" });
    expect(await jobStatus(jobId)).toEqual({ status: "failed", reason: "reader-invalid-output" });
    expect((await coreRows()).length).toBe(0);
    expect(model.doGenerateCalls.length).toBe(2);
  });

  test("core files already stored for the repo + SHA: no model call, job picked", async () => {
    const first = await newJob();
    await engine(first, happy).t.execute();
    await db.sql`UPDATE generation_jobs SET status = 'failed', reason = 'test' WHERE id = ${first}`;
    const second = await newJob();
    const { t, model } = engine(second, happy);
    expect((await t.executeStep("map-concepts")).result).toMatchObject({ status: "mapped", coreFiles: PICKS });
    expect(model.doGenerateCalls.length).toBe(0);
  });
});

describe("pick-core-files failure paths (fix batch)", () => {
  test("a cache write that fails (text with a NUL) does not fail or re-run the paid loop", async () => {
    const jobId = await newJob();
    const { t, model } = engine(jobId, happy, (g) => ({ ...g, readFile: async () => "a\u0000b" }));
    const { result } = await t.executeStep("map-concepts");
    expect(result).toMatchObject({ status: "mapped", coreFiles: PICKS });
    expect(model.doGenerateCalls.length).toBe(2);
    expect((await db.sql`SELECT count(*)::int AS n FROM repo_file_cache`)[0].n).toBe(0);
  });

  test("a non-retryable model error (400 prompt too long) fails the job at once: reader-error, one call", async () => {
    const jobId = await newJob();
    const error = new APICallError({
      message: "prompt is too long",
      url: "https://api.anthropic.com/v1/messages",
      requestBodyValues: {},
      statusCode: 400,
    });
    const { t, model } = engine(jobId, () => ({ error }));
    const { result } = await t.execute();
    expect(result).toMatchObject({ status: "failed", reason: "reader-error" });
    expect(await jobStatus(jobId)).toEqual({ status: "failed", reason: "reader-error" });
    expect(model.doGenerateCalls.length).toBe(1);
  });

  test("pick-core-files throws on every attempt: the job stays picking, then onFailure marks it failed / reader-error", async () => {
    const jobId = await newJob();
    const overloaded = Object.assign(new Error("Overloaded"), { statusCode: 529 });
    const { t, fn } = engine(jobId, () => ({ error: overloaded }));
    for (let attempt = 0; attempt < 4; attempt++) {
      const run = await t.execute();
      expect((run as { error?: Error }).error?.message).toMatch(/Overloaded/);
      expect((await jobStatus(jobId)).status).toBe("picking");
    }
    const onFailure = fn.opts.onFailure as unknown as (ctx: { event: unknown; error: Error }) => Promise<unknown>;
    await onFailure({
      event: {
        name: "inngest/function.failed",
        data: { event: { name: LADDER_GENERATE_EVENT, data: { ...DSET, jobId } } },
      },
      error: overloaded,
    });
    expect(await jobStatus(jobId)).toEqual({ status: "failed", reason: "reader-error" });
    expect((await coreRows()).length).toBe(0);
  });

  test("another job stores picks for the repo + SHA while this one runs: its rows are kept, never mixed", async () => {
    // (generation_jobs_open_key allows one open job per repo + SHA; this covers a failed job's step still running.)
    const other = [
      { path: "package.json", reason: "B: manifest" },
      { path: "src/index.js", reason: "B: entry" },
    ];
    const jobId = await newJob();
    const { t } = engine(jobId, happy, (g) => ({
      ...g,
      readFile: async (repo, sha, path) => {
        for (const [i, f] of other.entries())
          await db.sql`INSERT INTO core_files (repo_full_name, commit_sha, rank, path, reason)
            VALUES (${repo}, ${sha}, ${i + 1}, ${f.path}, ${f.reason})`;
        return g.readFile(repo, sha, path);
      },
    }));
    const { result } = await t.executeStep("map-concepts");
    expect(result).toMatchObject({ status: "mapped", coreFiles: other });
    expect(await coreRows()).toEqual(other.map((p, i) => ({ rank: i + 1, ...p })));
  });
});

describe("Inngest step pick-core-files on the claude-code back end (AC 9)", () => {
  test("claude not installed: the job fails at once with reader-not-installed (no retry)", async () => {
    const jobId = await newJob();
    const gh = fixtureFetch(fixtures, () => undefined);
    const fn = ladderGenerateFunction(createInngest(), {
      sql: db.sql,
      github: githubRepoClient({ baseUrl: "https://api.github.com", token: "t", fetch: gh.impl }),
      modelA: testModelA(),
      reader: {
        backend: "claude-code",
        claudeBin: join(tmpdir(), "il-no-such-dir", "claude"),
        limits: { maxSteps: 15, tokenBudget: 80_000 },
        logCost: () => {},
      },
    });
    const t = new InngestTestEngine({
      function: fn,
      events: [{ name: LADDER_GENERATE_EVENT, data: { ...DSET, jobId } }],
    });
    const { result } = await t.execute();
    expect(result).toMatchObject({ status: "failed", reason: "reader-not-installed" });
    expect(await jobStatus(jobId)).toEqual({ status: "failed", reason: "reader-not-installed" });
  });

  test("runs claude -p (fake), stores the picks, logs cost with backend claude-code and the app token for reads", async () => {
    const rec = await mkdtemp(join(tmpdir(), "il-fake-claude-"));
    const bin = join(rec, "claude");
    const fake = join(import.meta.dir, "support", "fake-claude.ts");
    await writeFile(bin, `#!/bin/sh\nexec "${process.execPath}" "${fake}" "${rec}" "$@"\n`);
    await chmod(bin, 0o755);
    const out = { is_error: false, num_turns: 3, session_id: "s", structured_output: { coreFiles: PICKS } };
    const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    await writeFile(join(rec, "replies.json"), JSON.stringify([{ stdout: JSON.stringify({ ...out, usage }) }]));
    const jobId = await newJob();
    const gh = fixtureFetch(fixtures, () => undefined);
    const costs: CostEntry[] = [];
    const fn = ladderGenerateFunction(createInngest(), {
      sql: db.sql,
      github: githubRepoClient({ baseUrl: "https://api.github.com", token: "t", fetch: gh.impl }),
      modelA: testModelA(),
      reader: {
        backend: "claude-code",
        githubToken: "app-token",
        claudeBin: bin,
        limits: { maxSteps: 15, tokenBudget: 80_000 },
        logCost: (e) => costs.push(e),
      },
    });
    const t = new InngestTestEngine({
      function: fn,
      events: [{ name: LADDER_GENERATE_EVENT, data: { ...DSET, jobId } }],
    });
    const { result } = await t.executeStep("map-concepts");
    expect(result).toMatchObject({ status: "mapped", coreFiles: PICKS });
    expect(await coreRows()).toEqual(PICKS.map((p, i) => ({ rank: i + 1, ...p })));
    expect(costs.filter((c) => c.step === "pick-core-files")).toEqual([
      {
        jobId,
        repo: DSET.repo,
        sha: DSET.sha,
        step: "pick-core-files",
        backend: "claude-code",
        model: "claude-code",
        inputTokens: 10,
        outputTokens: 5,
        cachedInputTokens: 0,
      },
    ]);
    const [call] = (await Bun.file(join(rec, "calls.jsonl")).text())
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(call.mcp.mcpServers.reader.env.GITHUB_TOKEN).toBe("app-token");
    await rm(rec, { recursive: true, force: true });
  });
});
