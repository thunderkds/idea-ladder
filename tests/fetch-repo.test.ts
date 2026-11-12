import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { InngestTestEngine } from "@inngest/test";
import { confidenceScore } from "../src/server/confidence.ts";
import { githubRepoClient } from "../src/server/github-repo.ts";
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
  const fn = ladderGenerateFunction(createInngest(), { sql: db.sql, github });
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
    const { result, ctx } = await t.execute();
    expect(result).toMatchObject({ status: "fetched" });
    expect(ctx.step.run.mock.calls.map((c) => c[0])).toEqual(["fetch-repo"]);
    expect(statuses).toEqual(["running"]);
    expect((await jobRow(jobId)).status).toBe("fetched");
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

    // Inngest retries the failed step alone (the function has one step; the event is not re-sent).
    const retry = await t.execute();
    expect(retry.result).toMatchObject({ status: "fetched" });
    expect((await jobRow(jobId)).status).toBe("fetched");
    expect(await snapshotCount()).toBe(1);
    expect(gh.calls.filter((p) => p === "/repos/lukeed/dset/languages").length).toBe(2);
    expect(retry.ctx.step.sendEvent.mock.calls.length).toBe(0);
  });

  test("the function retries a step up to 3 times, then onFailure marks the job failed", async () => {
    const jobId = await newJob(DSET.repo, DSET.sha);
    const fn = ladderGenerateFunction(createInngest(), {
      sql: db.sql,
      github: githubRepoClient({ baseUrl: "https://api.github.com", token: "t", fetch: fixtureFetch(fixtures).impl }),
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
