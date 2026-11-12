// Per-learner limit on creating new generation jobs (security review P1): START_MAX_NEW_JOBS_PER_HOUR.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { V0_REPOS } from "./support/github-fixtures.ts";
import { startHarness } from "./support/start-harness.ts";

const LIMIT = 2;
let h: Awaited<ReturnType<typeof startHarness>>;
let a: string;

beforeAll(async () => {
  h = await startHarness({ START_MAX_NEW_JOBS_PER_HOUR: String(LIMIT) });
});
afterAll(async () => {
  await h.db.drop();
});
beforeEach(async () => {
  await h.reset();
  a = await h.learner();
});

const json = async (res: Response) => (await res.json()) as Record<string, unknown>;

describe("per-learner new-job limit", () => {
  test("allowed up to N, refused at N+1 with 429 too-many-starts + retryAt; no job, no event", async () => {
    expect((await h.post("developit/mitt", a)).status).toBe(202);
    expect((await h.post("lukeed/dset", a)).status).toBe(202);
    const [{ oldest }] = await h.db.sql`SELECT min(created_at) AS oldest FROM generation_jobs`;
    const refused = await h.post("the-pocket/pocketflow", a);
    expect(refused.status).toBe(429);
    const body = await json(refused);
    expect(body).toEqual({ error: "too-many-starts", retryAt: new Date(oldest.getTime() + 3_600_000).toISOString() });
    expect(await h.count("generation_jobs")).toBe(2);
    expect(h.state.sent.length).toBe(2);

    const page = await h.get("/start?url=the-pocket/pocketflow", a);
    expect(page.status).toBe(429);
    expect(await page.text()).toContain(`data-error="too-many-starts" data-retry-at="${body.retryAt}"`);
  });

  test("another learner is not affected", async () => {
    await h.post("developit/mitt", a);
    await h.post("lukeed/dset", a);
    const b = await h.learner();
    expect((await h.post("the-pocket/pocketflow", b)).status).toBe(202);
  });

  test("joining an open job and a cache hit do not count", async () => {
    const b = await h.learner();
    const { jobId } = await json(await h.post("the-pocket/pocketflow", b));
    await h.post("developit/mitt", a);
    await h.post("lukeed/dset", a);
    const join = await h.post("the-pocket/pocketflow", a); // a is at the limit
    expect(join.status).toBe(202);
    expect((await json(join)).jobId).toBe(jobId);
    await h.db.sql`INSERT INTO ladders (repo_full_name, commit_sha, status)
      VALUES ('developit/mitt', ${V0_REPOS["developit/mitt"]}, 'unverified')`;
    expect((await h.post("developit/mitt", a)).status).toBe(200);
  });

  test("jobs older than one hour do not count", async () => {
    await h.post("developit/mitt", a);
    await h.post("lukeed/dset", a);
    await h.db.sql`UPDATE generation_jobs SET created_at = now() - interval '61 minutes', status = 'failed'`;
    expect((await h.post("the-pocket/pocketflow", a)).status).toBe(202);
  });
});
