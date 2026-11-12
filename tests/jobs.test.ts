import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { V0_REPOS } from "./support/github-fixtures.ts";
import { startHarness } from "./support/start-harness.ts";

const MITT_SHA = V0_REPOS["developit/mitt"];
let h: Awaited<ReturnType<typeof startHarness>>;

beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.db.drop();
});
beforeEach(async () => {
  await h.reset();
});

async function startJob(cookie: string): Promise<string> {
  const res = await h.post("developit/mitt", cookie);
  expect(res.status).toBe(202);
  return ((await res.json()) as { jobId: string }).jobId;
}

describe("GET /api/jobs/:jobId (AC 7)", () => {
  test("the learner who started it sees { status, repo, sha }; no-store", async () => {
    const starter = await h.learner();
    const jobId = await startJob(starter);
    const res = await h.get(`/api/jobs/${jobId}`, starter);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ status: "queued", repo: "developit/mitt", sha: MITT_SHA });
  });

  test("a learner waiting on the same repo + SHA sees it; any other learner gets 404", async () => {
    const jobId = await startJob(await h.learner());
    const waiter = await h.learner();
    expect(await startJob(waiter)).toBe(jobId);
    expect((await h.get(`/api/jobs/${jobId}`, waiter)).status).toBe(200);
    expect((await h.get(`/api/jobs/${jobId}`, await h.learner())).status).toBe(404);
  });

  test("failed shows the reason and reset time; a ladder for the repo + SHA shows ladderId", async () => {
    const starter = await h.learner();
    const jobId = await startJob(starter);
    const resetAt = new Date(Date.now() + 600_000);
    await h.db.sql`UPDATE generation_jobs SET status = 'failed', reason = 'rate-limited', reset_at = ${resetAt}
      WHERE id = ${jobId}`;
    expect(await (await h.get(`/api/jobs/${jobId}`, starter)).json()).toEqual({
      status: "failed",
      reason: "rate-limited",
      resetAt: resetAt.toISOString(),
      repo: "developit/mitt",
      sha: MITT_SHA,
    });
    const [{ id }] = await h.db.sql`INSERT INTO ladders (repo_full_name, commit_sha, status)
      VALUES ('developit/mitt', ${MITT_SHA}, 'unverified') RETURNING id::text`;
    expect(await (await h.get(`/api/jobs/${jobId}`, starter)).json()).toMatchObject({ ladderId: id });
  });

  test("unknown or malformed id -> 404; signed out -> 401", async () => {
    const cookie = await h.learner();
    expect((await h.get("/api/jobs/00000000-0000-0000-0000-000000000000", cookie)).status).toBe(404);
    expect((await h.get("/api/jobs/not-a-uuid", cookie)).status).toBe(404);
    expect((await h.get("/api/jobs/00000000-0000-0000-0000-000000000000")).status).toBe(401);
  });
});

describe("GET /jobs/:jobId status page (AC 7)", () => {
  test("signed in -> the client page; signed out -> redirect to /", async () => {
    const cookie = await h.learner();
    const jobId = await startJob(cookie);
    const page = await h.get(`/jobs/${jobId}`, cookie);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<div id="root">');
    expect(page.headers.get("cache-control")).toBe("no-store");
    const out = await h.get(`/jobs/${jobId}`);
    expect(out.status).toBe(302);
    expect(out.headers.get("location")).toBe("/");
  });
});
