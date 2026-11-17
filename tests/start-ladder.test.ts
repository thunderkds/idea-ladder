import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { rateLimited, V0_REPOS } from "./support/github-fixtures.ts";
import { type GithubStub, startGithubStub } from "./support/github-stub.ts";
import { BASE, startHarness } from "./support/start-harness.ts";

const MITT_SHA = V0_REPOS["developit/mitt"];
let h: Awaited<ReturnType<typeof startHarness>>;
let cookie: string;

beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.db.drop();
});
beforeEach(async () => {
  await h.reset();
  cookie = await h.learner();
});

const json = async (res: Response) => (await res.json()) as Record<string, unknown>;
const insertLadder = async (repo: string, sha: string) =>
  (
    await h.db.sql`INSERT INTO ladders (repo_full_name, commit_sha, status) VALUES (${repo}, ${sha}, 'unverified')
      RETURNING id::text`
  )[0].id as string;

describe("POST /api/start: cache by repo + SHA (AC 2, SC 2-3)", () => {
  test("cache hit -> 200 { ladderId }, 1 GitHub call with the app token, no job, no event", async () => {
    const ladderId = await insertLadder("developit/mitt", MITT_SHA);
    const res = await h.post("https://github.com/developit/mitt", cookie);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ladderId });
    expect(h.gh.calls).toEqual(["/repos/developit/mitt/commits?per_page=1"]);
    expect(h.state.sent.length).toBe(0);
    expect(await h.count("generation_jobs")).toBe(0);
  });

  test("miss -> 202 { jobId } and one ladder/generate.requested event { repo, sha, jobId }", async () => {
    const original = globalThis.fetch;
    let otherNetworkCalls = 0;
    globalThis.fetch = (async () => {
      otherNetworkCalls++; // any model / other HTTP call would land here
      throw new Error("unexpected network call");
    }) as unknown as typeof fetch;
    let res: Response;
    try {
      res = await h.post("developit/mitt", cookie);
    } finally {
      globalThis.fetch = original;
    }
    expect(res.status).toBe(202);
    const { jobId } = await json(res);
    expect(jobId).toMatch(/^[0-9a-f-]{36}$/);
    expect(h.state.sent).toEqual([{ repo: "developit/mitt", sha: MITT_SHA, jobId: jobId as string }]);
    expect(h.gh.calls.length).toBe(1);
    expect(otherNetworkCalls).toBe(0);
    const [job] = await h.db.sql`SELECT status, repo_full_name, commit_sha FROM generation_jobs`;
    expect(job).toEqual({ status: "queued", repo_full_name: "developit/mitt", commit_sha: MITT_SHA });
  });

  test("letter case does not change the cache key", async () => {
    const a = await json(await h.post("developit/mitt", cookie));
    const b = await json(await h.post("https://github.com/Developit/Mitt", await h.learner()));
    expect(b.jobId).toBe(a.jobId);
    expect(h.state.sent.length).toBe(1);
  });

  test("a failed job does not block a new one for the same repo + SHA", async () => {
    const first = await json(await h.post("developit/mitt", cookie));
    await h.db
      .sql`UPDATE generation_jobs SET status = 'failed', reason = 'rate-limited' WHERE id = ${first.jobId as string}`;
    const second = await json(await h.post("developit/mitt", cookie));
    expect(second.jobId).not.toBe(first.jobId);
    expect(h.state.sent.length).toBe(2);
  });

  test("renamed repo: one redirect is followed and the canonical name is the cache key", async () => {
    h.state.override = (path) =>
      path === "/repos/old-owner/mitt/commits?per_page=1"
        ? new Response(null, {
            status: 301,
            headers: { location: "https://api.github.com/repositories/1/commits?per_page=1" },
          })
        : path === "/repositories/1/commits?per_page=1"
          ? Response.json([{ sha: MITT_SHA, html_url: `https://github.com/developit/mitt/commit/${MITT_SHA}` }])
          : undefined;
    const res = await h.post("old-owner/mitt", cookie);
    expect(res.status).toBe(202);
    expect(h.state.sent[0]?.repo).toBe("developit/mitt");
    expect(h.gh.calls.length).toBe(2);
  });

  test("a redirect to another host is refused (the token is never sent there)", async () => {
    h.state.override = (path) =>
      path.startsWith("/repos/developit/mitt/commits")
        ? new Response(null, { status: 302, headers: { location: "https://evil.example/steal" } })
        : undefined;
    const res = await h.post("developit/mitt", cookie);
    expect(res.status).toBe(502);
    expect(await json(res)).toEqual({ error: "github-unavailable" });
    expect(h.gh.calls.length).toBe(1);
  });
});

describe("POST /api/start: concurrency (AC 4, SC 4)", () => {
  test("2 parallel calls, empty DB -> 1 job row, same jobId, 1 event", async () => {
    const other = await h.learner();
    const [a, b] = await Promise.all([h.post("developit/mitt", cookie), h.post("developit/mitt", other)]);
    expect([a.status, b.status]).toEqual([202, 202]);
    const [ja, jb] = [await json(a), await json(b)];
    expect(ja.jobId).toBe(jb.jobId);
    expect(await h.count("generation_jobs")).toBe(1);
    expect(h.state.sent.length).toBe(1);
  });
});

describe("POST /api/start: errors (AC 6, edge cases)", () => {
  test("repo 404 -> 404 { error: repo-not-found }, no job", async () => {
    const res = await h.post("nobody-here/no-such-repo", cookie);
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: "repo-not-found" });
    expect(await h.count("generation_jobs")).toBe(0);
  });

  test("rate limit when resolving the SHA -> 503 { error: rate-limited, resetAt }, no job", async () => {
    const reset = Math.floor(Date.now() / 1000) + 900;
    h.state.override = () => rateLimited(reset);
    const res = await h.post("developit/mitt", cookie);
    expect(res.status).toBe(503);
    expect(await json(res)).toEqual({ error: "rate-limited", resetAt: new Date(reset * 1000).toISOString() });
    expect(await h.count("generation_jobs")).toBe(0);
  });

  test("empty repo (409 from GitHub) -> 422 { error: repo-empty }, no job", async () => {
    h.state.override = () => Response.json({ message: "Git Repository is empty." }, { status: 409 });
    const res = await h.post("developit/mitt", cookie);
    expect(res.status).toBe(422);
    expect(await json(res)).toEqual({ error: "repo-empty" });
    expect(await h.count("generation_jobs")).toBe(0);
  });

  test("[] from /commits (no commits) -> 422 { error: repo-empty }, no job", async () => {
    h.state.override = (path) =>
      path.startsWith("/repos/developit/mitt/commits")
        ? Response.json([], { headers: { "x-ratelimit-remaining": "4999" } })
        : undefined;
    const res = await h.post("developit/mitt", cookie);
    expect(res.status).toBe(422);
    expect(await json(res)).toEqual({ error: "repo-empty" });
    expect(await h.count("generation_jobs")).toBe(0);
  });

  test("unsupported URL -> 400 { error: unsupported-url }, no GitHub call", async () => {
    const res = await h.post("https://gitlab.com/o/n", cookie);
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: "unsupported-url" });
    expect(h.gh.calls.length).toBe(0);
  });

  test("url missing, not a string or > 2,048 chars -> 400", async () => {
    for (const url of [undefined, "", 42, `https://github.com/o/${"n".repeat(2048)}`]) {
      const res = await h.post(url, cookie);
      expect(res.status).toBe(400);
      expect(String((await json(res)).error)).toMatch(/^url-(required|too-long)$/);
    }
    const bad = await h.app.request(`${BASE}/api/start`, { method: "POST", headers: { cookie }, body: "not json" });
    expect(bad.status).toBe(400);
    expect(h.gh.calls.length).toBe(0);
  });

  test("signed out -> 401, no GitHub call", async () => {
    const res = await h.post("developit/mitt");
    expect(res.status).toBe(401);
    expect(h.gh.calls.length).toBe(0);
  });

  test("the event cannot be sent -> 503 { error: queue-unavailable } and the job is failed, not stuck queued", async () => {
    h.state.enqueueFails = true;
    const res = await h.post("developit/mitt", cookie);
    expect(res.status).toBe(503);
    expect(await json(res)).toEqual({ error: "queue-unavailable" });
    const [job] = await h.db.sql`SELECT status, reason FROM generation_jobs`;
    expect(job).toEqual({ status: "failed", reason: "queue-unavailable" });
  });
});

describe("GET /start?url= browser contract (AC 3)", () => {
  const START = `/start?url=${encodeURIComponent("https://github.com/developit/mitt")}`;

  test("signed in, miss -> 302 /jobs/:jobId; hit -> 302 /ladders/:ladderId", async () => {
    const miss = await h.get(START, cookie);
    expect(miss.status).toBe(302);
    expect(miss.headers.get("location")).toBe(`/jobs/${h.state.sent[0]?.jobId}`);
    expect(miss.headers.get("cache-control")).toBe("no-store");
    const ladderId = await insertLadder("developit/mitt", MITT_SHA);
    const hit = await h.get(START, cookie);
    expect(hit.status).toBe(302);
    expect(hit.headers.get("location")).toBe(`/ladders/${ladderId}`);
  });

  test("unsupported URL -> 400 page naming the problem; signed out or in; no GitHub call", async () => {
    for (const who of [undefined, cookie]) {
      const res = await h.get(`/start?url=${encodeURIComponent("javascript:alert(1)")}`, who);
      expect(res.status).toBe(400);
      expect(await res.text()).toContain('<div id="root" data-error="unsupported-url">');
    }
    expect(h.gh.calls.length).toBe(0);
  });

  test("missing or > 2,048-char url -> 400 page", async () => {
    const missing = await h.get("/start", cookie);
    expect(missing.status).toBe(400);
    expect(await missing.text()).toContain('data-error="url-required"');
    const long = await h.get(`/start?url=${"a".repeat(2049)}`, cookie);
    expect(long.status).toBe(400);
    expect(await long.text()).toContain('data-error="url-too-long"');
  });

  test("errors render the page with the code; rate limit carries the reset time", async () => {
    const missing = await h.get(`/start?url=nobody-here/no-such-repo`, cookie);
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain('data-error="repo-not-found"');
    const reset = Math.floor(Date.now() / 1000) + 60;
    h.state.override = () => rateLimited(reset);
    const limited = await h.get(START, cookie);
    expect(limited.status).toBe(503);
    expect(await limited.text()).toContain(
      `data-error="rate-limited" data-reset-at="${new Date(reset * 1000).toISOString()}"`,
    );
  });
});

describe("GET /start?url= signed out: sign in, then back to the same /start (AC 3)", () => {
  let stub: GithubStub;
  let oauth: Awaited<ReturnType<typeof startHarness>>["app"];
  beforeAll(async () => {
    const { createApp } = await import("../src/server/app.ts");
    const { loadConfig } = await import("../src/server/config.ts");
    stub = startGithubStub({ user: { id: 77, login: "radar" }, clientId: "cid", clientSecret: "csecret" });
    const config = loadConfig({
      DATABASE_URL: h.db.url,
      GITHUB_CLIENT_ID: "cid",
      GITHUB_CLIENT_SECRET: "csecret",
      GITHUB_APP_TOKEN: "test-app-token",
      SESSION_SECRET: "y".repeat(48),
      ANTHROPIC_API_KEY: "sk-ant-test",
      MODEL_A_ID: "test-model",
      GITHUB_OAUTH_BASE_URL: stub.url,
      GITHUB_API_BASE_URL: stub.url,
      NODE_ENV: "test",
    });
    oauth = createApp({ config, sql: h.db.sql, clientDir: "tests/fixtures/client" });
  });
  afterAll(() => stub.stop());

  const pairs = (res: Response) => res.headers.getSetCookie().map((c) => c.split(";")[0] ?? "");

  /** /auth/github?next=... -> GitHub stub -> callback; returns the callback's redirect target. */
  async function signInVia(next: string): Promise<string | null> {
    const start = await oauth.request(`${BASE}/auth/github?next=${encodeURIComponent(next)}`);
    const state = new URL(start.headers.get("location") ?? "").searchParams.get("state") ?? "";
    const cookies = pairs(start).filter((c) => !c.endsWith("="));
    const cb = await oauth.request(`${BASE}/auth/github/callback?code=${stub.issueCode()}&state=${state}`, {
      headers: { cookie: cookies.join("; ") },
    });
    expect(cb.status).toBe(302);
    expect(pairs(cb).some((c) => c === "il_return_to=")).toBe(true); // cleared on use
    return cb.headers.get("location");
  }

  test("redirects to sign-in carrying the /start path, then lands back on it", async () => {
    const path = `/start?url=${encodeURIComponent("https://github.com/developit/mitt")}`;
    const res = await oauth.request(`${BASE}${path}`);
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toBe(`/auth/github?next=${encodeURIComponent(path)}`);
    expect(await signInVia(new URL(location, BASE).searchParams.get("next") ?? "")).toBe(path);
  });

  test("a return target that is not a same-origin /start?url= path is ignored", async () => {
    for (const next of [
      "https://evil.example/start?url=x",
      "//evil.example/start?url=x",
      "/\\evil.example/start?url=x",
      "/ladders",
      "/start/../auth/sign-out?url=x",
      "/startx?url=x",
      "/start?url=x\r\nSet-Cookie: a=b",
      "/start?url=x%0d%0aSet-Cookie:%20a=b",
    ]) {
      expect(await signInVia(next)).toBe("/ladders");
    }
  });
});
