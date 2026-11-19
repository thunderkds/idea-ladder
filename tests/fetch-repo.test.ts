import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { InngestTestEngine } from "@inngest/test";
import { confidenceScore } from "../src/server/confidence.ts";
import { githubRepoClient, RateLimitError } from "../src/server/github-repo.ts";
import { createInngest, LADDER_GENERATE_EVENT, ladderGenerateFunction } from "../src/server/ladder-generate.ts";
import { migrateUp } from "../src/server/migrate.ts";
import { createTestDatabase } from "./support/db.ts";
import {
  type Fixture,
  fixtureFetch,
  loadFixture,
  type Override,
  rateLimited,
  V0_REPOS,
} from "./support/github-fixtures.ts";
import { testModelA, testReader } from "./support/mock-model.ts";

let db: Awaited<ReturnType<typeof createTestDatabase>>;
let fixtures: Fixture[];
let userId: string;

beforeAll(async () => {
  db = await createTestDatabase();
  await migrateUp(db.sql);
  fixtures = await Promise.all(Object.keys(V0_REPOS).map((r) => loadFixture(r as keyof typeof V0_REPOS)));
  [{ id: userId }] = await db.sql`INSERT INTO users (github_id, github_login) VALUES (42, 'octo') RETURNING id::text`;
});
afterAll(async () => {
  await db.drop();
});
beforeEach(async () => {
  await db.sql`TRUNCATE generation_jobs, repo_snapshots CASCADE`;
});

const DSET = { repo: "lukeed/dset", sha: V0_REPOS["lukeed/dset"] };

async function newJob(repo: string, sha: string): Promise<string> {
  const [job] = await db.sql`
    INSERT INTO generation_jobs (repo_full_name, commit_sha, started_by) VALUES (${repo}, ${sha}, ${userId})
    RETURNING id::text`;
  return job.id;
}

function engine(jobId: string, override?: Override) {
  const gh = fixtureFetch(fixtures, override);
  const github = githubRepoClient({ baseUrl: "https://api.github.com", token: "test-token", fetch: gh.impl });
  const fn = ladderGenerateFunction(createInngest(), {
    sql: db.sql,
    github,
    reader: testReader(),
    modelA: testModelA(),
  });
  const t = new InngestTestEngine({
    function: fn,
    events: [{ name: LADDER_GENERATE_EVENT, data: { ...DSET, jobId } }],
  });
  return { t, gh };
}

const jobRow = async (id: string) =>
  (await db.sql`SELECT status, reason, reset_at FROM generation_jobs WHERE id = ${id}`)[0] as {
    status: string;
    reason: string | null;
    reset_at: Date | null;
  };
const snapshotCount = async () => Number((await db.sql`SELECT count(*)::int AS n FROM repo_snapshots`)[0].n);

/** Ends a run right after map-concepts: the T008 steps are not under test here. */
const STUB_CHUNK = { id: "chunk", handler: async () => ({ status: "stub" }) };

describe("confidence rule (T001 port)", () => {
  test("the 3 recorded v0 repos score 0.9 high, as in T001 RESULTS § 3", async () => {
    const gh = fixtureFetch(fixtures);
    const github = githubRepoClient({ baseUrl: "https://api.github.com", token: "t", fetch: gh.impl });
    for (const [repo, sha] of Object.entries(V0_REPOS)) {
      const c = confidenceScore(await github.fetchSnapshot(repo, sha));
      expect({ repo, score: c.score, level: c.level }).toEqual({ repo, score: 0.9, level: "high" });
      expect(c.reasons).toEqual(["0 good first issue (-0.1)"]);
    }
  });

  test("thin README and no issues falls back to concepts", () => {
    const c = confidenceScore({ readme: "tiny", openIssues: 0, goodFirstIssues: 0, depFiles: [] });
    expect(c).toEqual({
      score: 0,
      level: "low",
      fallbackToConcepts: true,
      reasons: [
        "README 4 chars < 1500 (-0.4)",
        "0 open issues (-0.3)",
        "0 good first issue (-0.1)",
        "no dependency file (-0.2)",
      ],
    });
    // 100 - 30 - 10 - 20 = 40: the lowest "medium"; 39 would be "low".
    expect(
      confidenceScore({ readme: "x".repeat(1500), openIssues: 0, goodFirstIssues: 0, depFiles: [] }),
    ).toMatchObject({
      score: 0.4,
      level: "medium",
      fallbackToConcepts: false,
    });
  });
});

describe("Inngest function ladder-generate, step fetch-repo (AC 5)", () => {
  test("stores the snapshot and confidence for the pinned SHA; job queued -> running -> fetched", async () => {
    const jobId = await newJob(DSET.repo, DSET.sha);
    expect((await jobRow(jobId)).status).toBe("queued");
    const { t, gh } = engine(jobId, (path) => {
      // Observe the job mid-step: status must already be running when GitHub is first called.
      if (path === "/repos/lukeed/dset") void jobRow(jobId).then((r) => statuses.push(r.status));
      return undefined;
    });
    const statuses: string[] = [];
    // chunk (T008) is stubbed so the run ends right after map-concepts.
    const { result, ctx } = await t.execute({ steps: [STUB_CHUNK] });
    expect(result).toEqual({ status: "stub" });
    expect(ctx.step.run.mock.calls.map((c) => c[0])).toEqual([
      "fetch-repo",
      "pick-core-files",
      "map-concepts",
      "chunk",
    ]);
    expect(statuses).toEqual(["running"]);
    expect((await jobRow(jobId)).status).toBe("mapped");
    expect(gh.calls.length).toBe(6);
    expect(gh.calls.every((p) => p.startsWith("/repos/lukeed/dset"))).toBe(true);

    const [snap] = await db.sql`SELECT * FROM repo_snapshots WHERE repo_full_name = 'lukeed/dset'`;
    expect(snap.commit_sha).toMatch(/^[0-9a-f]{40}$/);
    expect(snap.commit_sha).toBe(DSET.sha);
    expect(snap.default_branch).toBe("master");
    expect(snap.archived).toBe(false);
    expect(snap.readme.length).toBeGreaterThanOrEqual(1500);
    expect(snap.dep_files).toEqual(["package.json"]);
    expect(snap.open_issues).toBeGreaterThan(0);
    expect(snap.good_first_issues).toBe(0);
    expect(Object.keys(snap.languages)).toContain("JavaScript");
    expect(Array.isArray(snap.topics)).toBe(true);
    expect(snap.tree.some((t: { path: string }) => t.path === "package.json")).toBe(true);

    const [conf] = await db.sql`SELECT * FROM repo_confidence WHERE repo_full_name = 'lukeed/dset'`;
    expect({ score: Number(conf.score), level: conf.level, fallback: conf.fallback_to_concepts }).toEqual({
      score: 0.9,
      level: "high",
      fallback: false,
    });
    expect(conf.reasons).toEqual(["0 good first issue (-0.1)"]);
  });
});

describe("rate limit in fetch-repo (AC 6, NFR-009)", () => {
  test("403 + x-ratelimit-remaining: 0 -> failed / rate-limited with reset time, no snapshot, no retry", async () => {
    const jobId = await newJob(DSET.repo, DSET.sha);
    const reset = Math.floor(Date.now() / 1000) + 600;
    const { t } = engine(jobId, (path) => (path.includes("/git/trees/") ? rateLimited(reset) : undefined));
    const { result } = await t.execute();
    expect(result).toMatchObject({ status: "failed", reason: "rate-limited" });
    const row = await jobRow(jobId);
    expect(row.status).toBe("failed");
    expect(row.reason).toBe("rate-limited");
    expect(row.reset_at?.getTime()).toBe(reset * 1000);
    expect(await snapshotCount()).toBe(0);
    expect(Number((await db.sql`SELECT count(*)::int AS n FROM repo_confidence`)[0].n)).toBe(0);
  });
});

describe("fetch-repo: other GitHub answers", () => {
  test("404 on /repos/... -> failed / repo-not-found, no snapshot", async () => {
    const jobId = await newJob(DSET.repo, DSET.sha);
    const { t } = engine(jobId, (path) =>
      path === "/repos/lukeed/dset" ? Response.json({ message: "Not Found" }, { status: 404 }) : undefined,
    );
    const { result } = await t.execute();
    expect(result).toMatchObject({ status: "failed", reason: "repo-not-found" });
    expect(await jobRow(jobId)).toMatchObject({ status: "failed", reason: "repo-not-found" });
    expect(await snapshotCount()).toBe(0);
  });

  test("401 -> failed / github-error at once (not retried), no snapshot", async () => {
    const jobId = await newJob(DSET.repo, DSET.sha);
    const { t, gh } = engine(jobId, (path) =>
      path === "/repos/lukeed/dset/languages"
        ? Response.json({ message: "Bad credentials" }, { status: 401 })
        : undefined,
    );
    const { result } = await t.execute();
    expect(result).toMatchObject({ status: "failed", reason: "github-error" });
    expect(await jobRow(jobId)).toMatchObject({ status: "failed", reason: "github-error" });
    expect(await snapshotCount()).toBe(0);
    expect(gh.calls.filter((p) => p === "/repos/lukeed/dset/languages").length).toBe(1);
  });

  test("archived repo is allowed and noted in the snapshot", async () => {
    const jobId = await newJob(DSET.repo, DSET.sha);
    const dset = fixtures.find((f) => f.fullName === "lukeed/dset");
    const entry = dset?.entries["/repos/lukeed/dset"];
    if (!entry) throw new Error("fixture /repos/lukeed/dset missing");
    const { t } = engine(jobId, (path) =>
      path === "/repos/lukeed/dset"
        ? Response.json({ ...JSON.parse(entry.body), archived: true }, { headers: entry.headers })
        : undefined,
    );
    expect((await t.executeStep("map-concepts")).result).toMatchObject({ status: "mapped" });
    const [snap] = await db.sql`SELECT archived FROM repo_snapshots WHERE repo_full_name = 'lukeed/dset'`;
    expect(snap.archived).toBe(true);
  });

  test("a forged event cannot pick the repo: repo + SHA come from the job row", async () => {
    const jobId = await newJob(DSET.repo, DSET.sha);
    const gh = fixtureFetch(fixtures);
    const github = githubRepoClient({ baseUrl: "https://api.github.com", token: "t", fetch: gh.impl });
    const fn = ladderGenerateFunction(createInngest(), {
      sql: db.sql,
      github,
      reader: testReader(),
      modelA: testModelA(),
    });
    const forged = { repo: "developit/mitt", sha: V0_REPOS["developit/mitt"], jobId };
    const t = new InngestTestEngine({ function: fn, events: [{ name: LADDER_GENERATE_EVENT, data: forged }] });
    expect((await t.executeStep("map-concepts")).result).toMatchObject({ status: "mapped" });
    expect(gh.calls.every((p) => p.startsWith("/repos/lukeed/dset"))).toBe(true);
    const rows = await db.sql`SELECT repo_full_name, commit_sha FROM repo_snapshots`;
    expect(rows.map((r: { repo_full_name: string; commit_sha: string }) => [r.repo_full_name, r.commit_sha])).toEqual([
      [DSET.repo, DSET.sha],
    ]);
  });

  test("an event for an unknown job id stores nothing", async () => {
    const gh = fixtureFetch(fixtures);
    const github = githubRepoClient({ baseUrl: "https://api.github.com", token: "t", fetch: gh.impl });
    const fn = ladderGenerateFunction(createInngest(), {
      sql: db.sql,
      github,
      reader: testReader(),
      modelA: testModelA(),
    });
    const data = { ...DSET, jobId: "00000000-0000-4000-8000-000000000000" };
    const t = new InngestTestEngine({ function: fn, events: [{ name: LADDER_GENERATE_EVENT, data }] });
    const run = await t.execute();
    expect((run as { error?: Error }).error?.message).toMatch(/unknown job/);
    expect(gh.calls.length).toBe(0);
    expect(await snapshotCount()).toBe(0);
  });
});

describe("GitHub client: redirects, rate-limit header, names", () => {
  const SHA_DSET = V0_REPOS["lukeed/dset"];
  type Call = { url: string; auth: string | null };
  function recording(responses: Response[]) {
    const calls: Call[] = [];
    const impl = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), auth: new Headers(init?.headers).get("authorization") });
      const next = responses.shift();
      if (!next) throw new Error("unexpected extra request");
      return next;
    }) as typeof fetch;
    return {
      calls,
      client: githubRepoClient({ baseUrl: "https://api.github.com", token: "secret-token", fetch: impl }),
    };
  }
  const redirect = (location: string) =>
    new Response(null, { status: 301, headers: { location, "x-ratelimit-remaining": "4999" } });
  const commits = (fullName: string) =>
    Response.json([{ sha: SHA_DSET, html_url: `https://github.com/${fullName}/commit/${SHA_DSET}` }], {
      headers: { "x-ratelimit-remaining": "4999" },
    });

  test("a same-origin 301 is followed once, with the token", async () => {
    const { calls, client } = recording([
      redirect("https://api.github.com/repositories/1/commits?per_page=1"),
      commits("NewOwner/dset"),
    ]);
    expect(await client.resolveHead({ owner: "old", name: "dset" })).toEqual({
      fullName: "newowner/dset",
      sha: SHA_DSET,
    });
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.github.com/repos/old/dset/commits?per_page=1",
      "https://api.github.com/repositories/1/commits?per_page=1",
    ]);
    expect(calls.every((c) => c.auth === "Bearer secret-token")).toBe(true);
  });

  test("a 301 to another origin throws; no request and no token go there", async () => {
    const { calls, client } = recording([redirect("https://evil.example/steal"), commits("x/y")]);
    await expect(client.resolveHead({ owner: "old", name: "dset" })).rejects.toThrow(/GitHub API 301/);
    expect(calls.length).toBe(1);
    expect(calls.some((c) => c.url.startsWith("https://evil.example"))).toBe(false);
  });

  test("a second redirect hop throws", async () => {
    const { calls, client } = recording([
      redirect("https://api.github.com/repositories/1/commits?per_page=1"),
      redirect("https://api.github.com/repositories/2/commits?per_page=1"),
      commits("x/y"),
    ]);
    await expect(client.resolveHead({ owner: "old", name: "dset" })).rejects.toThrow(/GitHub API 301/);
    expect(calls.length).toBe(2);
  });

  test("a non-numeric x-ratelimit-reset defaults to now + 60 s (no RangeError)", async () => {
    const limited = Response.json(
      { message: "API rate limit exceeded" },
      { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "soon" } },
    );
    const { client } = recording([limited]);
    const before = Date.now();
    const err = await client.resolveHead({ owner: "lukeed", name: "dset" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    const reset = (err as RateLimitError).resetAt.getTime();
    expect(reset).toBeGreaterThanOrEqual(before + 59_000);
    expect(reset).toBeLessThanOrEqual(Date.now() + 61_000);
    expect(() => (err as RateLimitError).resetAt.toISOString()).not.toThrow();
  });

  test('"." and ".." are refused as a repo name before any request', async () => {
    const { calls, client } = recording([]);
    for (const name of ["lukeed/.", "lukeed/.."]) {
      await expect(client.fetchSnapshot(name, SHA_DSET)).rejects.toThrow(/expected owner\/name/);
    }
    expect(calls.length).toBe(0);
  });
});

describe("retry (AC 8, NFR-005)", () => {
  test("a 5xx once: the step throws, the retry re-runs only fetch-repo and the job ends fetched", async () => {
    const jobId = await newJob(DSET.repo, DSET.sha);
    let failures = 0;
    const { t, gh } = engine(jobId, (path) => {
      if (path === "/repos/lukeed/dset/languages" && failures++ === 0) {
        return Response.json(
          { message: "Server Error" },
          { status: 502, headers: { "x-ratelimit-remaining": "4000" } },
        );
      }
      return undefined;
    });
    const first = await t.execute();
    expect((first as { error?: Error }).error?.message).toMatch(/GitHub API 502/);
    expect((await jobRow(jobId)).status).toBe("running"); // not failed: Inngest will retry
    expect(await snapshotCount()).toBe(0); // all-or-nothing

    // Inngest retries the failed step alone. (Not re-sending the event is startLadder's job, tested in
    // start-ladder.test.ts: only the inserting caller enqueues.)
    // chunk (T008) is stubbed so the retry ends right after map-concepts.
    const retry = await t.execute({ steps: [STUB_CHUNK] });
    expect(retry.result).toEqual({ status: "stub" });
    expect((await jobRow(jobId)).status).toBe("mapped");
    expect(await snapshotCount()).toBe(1);
    expect(gh.calls.filter((p) => p === "/repos/lukeed/dset/languages").length).toBe(2);
  });

  test("the function retries a step up to 3 times, then onFailure marks the job failed", async () => {
    const jobId = await newJob(DSET.repo, DSET.sha);
    const fn = ladderGenerateFunction(createInngest(), {
      sql: db.sql,
      github: githubRepoClient({ baseUrl: "https://api.github.com", token: "t", fetch: fixtureFetch(fixtures).impl }),
      reader: testReader(),
      modelA: testModelA(),
    });
    expect(fn.opts.retries).toBe(3);
    await failJobAfterRetries(fn, jobId);
    expect(await jobRow(jobId)).toMatchObject({ status: "failed", reason: "github-error" });
  });
});

/** Runs the function's onFailure handler the way Inngest does after the last retry. */
async function failJobAfterRetries(fn: ReturnType<typeof ladderGenerateFunction>, jobId: string) {
  const handler = fn.opts.onFailure as unknown as (ctx: { event: unknown; error: Error }) => Promise<unknown>;
  await handler({
    event: {
      name: "inngest/function.failed",
      data: { event: { name: LADDER_GENERATE_EVENT, data: { ...DSET, jobId } } },
    },
    error: new Error("GitHub API 502 for /repos/lukeed/dset/languages"),
  });
}
