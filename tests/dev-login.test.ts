// T034: local dev sign-in. GET /auth/github looks up DEV_LOGIN_GITHUB_LOGIN on a stub GitHub API with the app token.
import { afterAll, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { createApp } from "../src/server/app.ts";
import { signInUser } from "../src/server/auth.ts";
import { type Config, loadConfig } from "../src/server/config.ts";
import { githubRepoClient } from "../src/server/github-repo.ts";
import { migrateUp } from "../src/server/migrate.ts";
import { createTestDatabase } from "./support/db.ts";
import { fixtureFetch } from "./support/github-fixtures.ts";
import { FORK, LEARNER, PINNED, t013Fixture, UPSTREAM } from "./support/t013-github.ts";

const SECRET = "x".repeat(48);
const APP_TOKEN = "test-app-token-T034";
const BASE = "http://localhost";

/** Stub of api.github.com: answers GET /users/<login> with `answer`, records every request. */
const stub = {
  answer: (): Response => Response.json({ id: 583231, login: "octocat" }),
  requests: [] as { path: string; authorization: string | null }[],
};
let server: ReturnType<typeof Bun.serve>;
let db: Awaited<ReturnType<typeof createTestDatabase>>;
let config: Config;
let app: ReturnType<typeof createApp>;

const devConfig = (over: Record<string, string> = {}) =>
  loadConfig({
    DATABASE_URL: db.url,
    GITHUB_APP_TOKEN: APP_TOKEN,
    SESSION_SECRET: SECRET,
    GITHUB_API_BASE_URL: `http://localhost:${server.port}`,
    GITHUB_OAUTH_BASE_URL: `http://localhost:${server.port}`,
    NODE_ENV: "development",
    DEV_LOGIN_GITHUB_LOGIN: "octocat",
    ...over,
  });

beforeAll(async () => {
  // Under `bun test -t "T034"` the fetch/spawn spies of tests/mcq-no-llm.test.ts are made but its afterAll never runs.
  mock.restore();
  server = Bun.serve({
    port: 0,
    fetch(req) {
      stub.requests.push({ path: new URL(req.url).pathname, authorization: req.headers.get("authorization") });
      return new URL(req.url).pathname.startsWith("/users/")
        ? stub.answer()
        : new Response("not found", { status: 404 });
    },
  });
  db = await createTestDatabase();
  await migrateUp(db.sql);
  config = devConfig();
  app = createApp({ config, sql: db.sql, clientDir: "tests/fixtures/client" });
});
afterAll(async () => {
  server.stop(true);
  await db.drop();
});
beforeEach(async () => {
  stub.answer = () => Response.json({ id: 583231, login: "octocat" });
  stub.requests.length = 0;
  await db.sql`TRUNCATE artifacts, ladders, repo_snapshots, users CASCADE`;
});

const sessionOf = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0] ?? "")
    .find((c) => c.startsWith("il_session=") && c.length > "il_session=".length);
const users = () => db.sql`SELECT github_id::text AS github_id, github_login FROM users`;
const sessionCount = async () => Number((await db.sql`SELECT count(*)::int AS n FROM sessions`)[0].n);

describe("T034 dev login: Host check and cross-site refusal (Stage 4 P1, P2a)", () => {
  const get = (path: string, headers: Record<string, string> = {}) => app.request(`${BASE}${path}`, { headers });

  test("a Host other than localhost or 127.0.0.1 gets 403 on every route; no cookie, no user, no lookup", async () => {
    for (const host of [
      "attacker.example:3000",
      "attacker.example",
      "localhost.attacker.example",
      "127.0.0.1.nip.io",
    ]) {
      for (const path of ["/auth/github", "/api/me", "/", "/auth/github/callback?code=a&state=b"]) {
        const res = await get(path, { host });
        expect(`${host} ${path}: ${res.status}`).toBe(`${host} ${path}: 403`);
        expect(res.headers.getSetCookie()).toEqual([]);
      }
    }
    expect(await users()).toEqual([]);
    expect(stub.requests).toEqual([]);
  });

  test("Host localhost:3000 and 127.0.0.1:3000 sign in", async () => {
    for (const host of ["localhost:3000", "127.0.0.1:3000", "localhost", "LOCALHOST:3000"]) {
      const res = await get("/auth/github", { host });
      expect(`${host}: ${res.status}`).toBe(`${host}: 302`);
      expect(sessionOf(res)).toBeDefined();
    }
  });

  test("Sec-Fetch-Site cross-site: 400 failure page, no lookup, no cookie, no session", async () => {
    const res = await get("/auth/github", { "sec-fetch-site": "cross-site" });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Sign-in failed");
    expect(sessionOf(res)).toBeUndefined();
    expect(await users()).toEqual([]);
    expect(await sessionCount()).toBe(0);
    expect(stub.requests).toEqual([]);
  });

  test("Sec-Fetch-Site same-origin, none, same-site or missing: signs in", async () => {
    for (const site of ["same-origin", "none", "same-site", undefined]) {
      const res = await get("/auth/github", site ? { "sec-fetch-site": site } : {});
      expect(`${site}: ${res.status} ${Boolean(sessionOf(res))}`).toBe(`${site}: 302 true`);
    }
  });

  test("a valid session of that user: redirect to next with no lookup and no new session", async () => {
    const cookie = sessionOf(await get("/auth/github")) ?? "";
    stub.requests.length = 0;
    const res = await get("/auth/github?next=/review", { cookie });
    expect([res.status, res.headers.get("location")]).toEqual([302, "/review"]);
    expect(stub.requests).toEqual([]);
    expect(await sessionCount()).toBe(1);
  });
});

describe("T034 dev sign-in (AC 4, AC 7)", () => {
  test("GET /auth/github?next=/ladders/1: no GitHub redirect, a session for the looked-up account, back to next", async () => {
    const res = await app.request(`${BASE}/auth/github?next=/ladders/1`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/ladders/1");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const raw = res.headers.getSetCookie().find((c) => c.startsWith("il_session=")) ?? "";
    expect(raw).toMatch(/HttpOnly/);
    expect(raw).toMatch(/SameSite=Lax/);
    expect(raw).toMatch(/Max-Age=2592000/);
    expect(await users()).toEqual([{ github_id: "583231", github_login: "octocat" }]);
    const me = await app.request(`${BASE}/api/me`, { headers: { cookie: sessionOf(res) ?? "" } });
    expect(await me.json()).toEqual({ login: "octocat" });
  });

  test("the lookup is GET /users/<login> with the app token; no OAuth endpoint is called", async () => {
    await app.request(`${BASE}/auth/github`);
    expect(stub.requests).toEqual([{ path: "/users/octocat", authorization: `Bearer ${APP_TOKEN}` }]);
  });

  test("no next or a bad next: /ladders", async () => {
    for (const next of ["", "?next=https://evil.example/", "?next=//evil.example", "?next=/admin"]) {
      const res = await app.request(`${BASE}/auth/github${next}`);
      expect(`${next} -> ${res.headers.get("location")}`).toBe(`${next} -> /ladders`);
    }
  });

  test("the existing /auth/github?next= redirects of other routes work unchanged", async () => {
    const review = await app.request(`${BASE}/review`);
    expect(review.headers.get("location")).toBe("/auth/github?next=%2Freview");
    const res = await app.request(`${BASE}${review.headers.get("location")}`);
    expect(res.headers.get("location")).toBe("/review");
    const page = await app.request(`${BASE}/review`, { headers: { cookie: sessionOf(res) ?? "" } });
    expect(page.status).toBe(200);
  });

  test("signing in twice reuses one users row keyed by the numeric id; a renamed login is updated", async () => {
    await app.request(`${BASE}/auth/github`);
    stub.answer = () => Response.json({ id: 583231, login: "OctoCat" }); // same account, GitHub's canonical case
    expect((await app.request(`${BASE}/auth/github`)).status).toBe(302);
    expect(await users()).toEqual([{ github_id: "583231", github_login: "OctoCat" }]);
    expect(await sessionCount()).toBe(2);
  });

  test("the login in .env may differ in letter case; GitHub's canonical login is stored", async () => {
    const mixed = createApp({
      config: devConfig({ DEV_LOGIN_GITHUB_LOGIN: "OCTOCAT" }),
      sql: db.sql,
      clientDir: "tests/fixtures/client",
    });
    expect((await mixed.request(`${BASE}/auth/github`)).status).toBe(302);
    expect(await users()).toEqual([{ github_id: "583231", github_login: "octocat" }]);
  });
});

describe("T034 dev sign-in fails closed (AC 5)", () => {
  async function expectRejected(res: Response) {
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Sign-in failed");
    expect(sessionOf(res)).toBeUndefined();
    expect(await users()).toEqual([]);
    expect(await sessionCount()).toBe(0);
  }
  const cases: Record<string, () => Response> = {
    "unknown login (404)": () => Response.json({ message: "Not Found" }, { status: 404 }),
    "rate limit (403)": () =>
      Response.json({ message: "API rate limit exceeded" }, { status: 403, headers: { "x-ratelimit-remaining": "0" } }),
    "server error (502)": () => new Response("bad gateway", { status: 502 }),
    "id not a number": () => Response.json({ id: "x", login: "octocat" }),
    "id zero": () => Response.json({ id: 0, login: "octocat" }),
    "id negative": () => Response.json({ id: -5, login: "octocat" }),
    "id fractional": () => Response.json({ id: 1.5, login: "octocat" }),
    "no id": () => Response.json({ login: "octocat" }),
    "no login": () => Response.json({ id: 583231 }),
    "login not a string": () => Response.json({ id: 583231, login: 7 }),
    "a different login": () => Response.json({ id: 1, login: "someone-else" }),
    "not JSON": () => new Response("<html>", { headers: { "content-type": "text/html" } }),
    "JSON null": () => Response.json(null),
  };
  for (const [name, answer] of Object.entries(cases)) {
    test(name, async () => {
      stub.answer = answer;
      await expectRejected(await app.request(`${BASE}/auth/github?next=/review`));
    });
  }

  test("network error (nothing listening)", async () => {
    const down = createApp({
      config: devConfig({ GITHUB_API_BASE_URL: "http://127.0.0.1:1" }),
      sql: db.sql,
      clientDir: "tests/fixtures/client",
    });
    await expectRejected(await down.request(`${BASE}/auth/github`));
  });

  test("the failure log line has no token, no session secret and no response body", async () => {
    stub.answer = () => Response.json({ message: "secret-body-text" }, { status: 404 });
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      await app.request(`${BASE}/auth/github`);
      const logged = warn.mock.calls.map((args) => args.map(String).join(" ")).join("\n");
      expect(logged).toMatch(/dev sign-in failed/);
      for (const secret of [APP_TOKEN, SECRET, "secret-body-text"]) expect(logged).not.toContain(secret);
    } finally {
      warn.mockRestore();
    }
  });

  test("a direct call to /auth/github/callback with dev login set: 400, no OAuth call", async () => {
    await expectRejected(await app.request(`${BASE}/auth/github/callback?code=abc&state=def`));
    expect(stub.requests).toEqual([]);
  });
});

describe("T034 author check reads the dev sign-in id (AC 7, NFR-003)", () => {
  const gh = fixtureFetch([t013Fixture()]);
  const l2App = () =>
    createApp({
      config: devConfig({ DEV_LOGIN_GITHUB_LOGIN: LEARNER.login }),
      sql: db.sql,
      clientDir: "tests/fixtures/client",
      github: githubRepoClient({ baseUrl: "https://api.github.invalid", token: APP_TOKEN, fetch: gh.impl }),
      passedLevels: async () => ["L0", "L1"],
      emitArtifact: async () => {},
    });
  async function seedLadder() {
    await db.sql`INSERT INTO repo_snapshots (repo_full_name, commit_sha, default_branch, archived, readme, topics, languages, dep_files, open_issues, good_first_issues, tree, tree_truncated)
      VALUES (${UPSTREAM.fullName}, ${PINNED}, 'main', false, 'r', '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, 0, 0, '[]'::jsonb, false)`;
    const [l] = await db.sql`
      INSERT INTO ladders (repo_full_name, commit_sha, status) VALUES (${UPSTREAM.fullName}, ${PINNED}, 'unverified') RETURNING id::text AS id`;
    return l.id as string;
  }
  const postL2 = (a: ReturnType<typeof createApp>, ladderId: string, cookie: string) =>
    a.request(`${BASE}/api/ladders/${ladderId}/levels/L2/artifact`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ url: `https://github.com/${FORK.fullName}/tree/feature/retry` }),
    });

  test("dev sign-in reuses the normal sign-in's users row, and the L2 author check passes on that id", async () => {
    await signInUser(db.sql, SECRET, { id: LEARNER.githubId, login: LEARNER.login }); // a normal (OAuth) sign-in
    const before = await db.sql`SELECT id::text AS id FROM users`;
    stub.answer = () => Response.json({ id: LEARNER.githubId, login: LEARNER.login });
    const a = l2App();
    const res = await a.request(`${BASE}/auth/github`);
    expect(await db.sql`SELECT id::text AS id FROM users`).toEqual(before);
    const ladderId = await seedLadder();
    const l2 = await postL2(a, ladderId, sessionOf(res) ?? "");
    expect(l2.status).toBe(200);
    expect(await l2.json()).toMatchObject({ artifact: { level: "L2" } });
  });

  test("the id from the lookup, not the login in .env, is the identity: another id is an author mismatch", async () => {
    stub.answer = () => Response.json({ id: 777, login: LEARNER.login }); // same login string, another account id
    const a = l2App();
    const res = await a.request(`${BASE}/auth/github`);
    expect(await users()).toEqual([{ github_id: "777", github_login: LEARNER.login }]);
    const l2 = await postL2(a, await seedLadder(), sessionOf(res) ?? "");
    expect([l2.status, await l2.json()]).toEqual([422, { error: "artifact-rejected", reason: "author-mismatch" }]);
  });
});
