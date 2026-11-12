import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/server/app.ts";
import { type Config, loadConfig } from "../src/server/config.ts";
import { migrateUp } from "../src/server/migrate.ts";
import { createTestDatabase } from "./support/db.ts";
import { type GithubStub, startGithubStub } from "./support/github-stub.ts";

const CLIENT_ID = "test-client-id";
const CLIENT_SECRET = "test-client-secret";

let db: Awaited<ReturnType<typeof createTestDatabase>>;
let stub: GithubStub;
let config: Config;
let clock = Date.now();
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  db = await createTestDatabase();
  await migrateUp(db.sql);
  stub = startGithubStub({ user: { id: 42, login: "octo" }, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
  config = loadConfig({
    DATABASE_URL: db.url,
    GITHUB_CLIENT_ID: CLIENT_ID,
    GITHUB_CLIENT_SECRET: CLIENT_SECRET,
    SESSION_SECRET: "x".repeat(48),
    GITHUB_OAUTH_BASE_URL: stub.url,
    GITHUB_API_BASE_URL: stub.url,
    NODE_ENV: "test",
  });
  app = createApp({ config, sql: db.sql, clientDir: "tests/fixtures/client", now: () => clock });
});
afterAll(async () => {
  stub.stop();
  await db.drop();
});
beforeEach(async () => {
  clock = Date.now();
  stub.setUser({ id: 42, login: "octo" });
  await db.sql`DELETE FROM users`;
});

const BASE = "http://localhost";
const cookiesOf = (res: Response) => res.headers.getSetCookie();
const cookieValue = (res: Response, name: string) =>
  cookiesOf(res)
    .map((c) => c.split(";")[0] ?? "")
    .find((c) => c.startsWith(`${name}=`) && c.length > name.length + 1);
const userCount = async () => Number((await db.sql`SELECT count(*)::int AS n FROM users`)[0].n);
const sessionCount = async () => Number((await db.sql`SELECT count(*)::int AS n FROM sessions`)[0].n);

/** Starts sign-in; returns the state from the authorize redirect and the state cookie. */
async function startSignIn() {
  const res = await app.request(`${BASE}/auth/github`);
  const location = new URL(res.headers.get("location") ?? "");
  return {
    res,
    location,
    state: location.searchParams.get("state") ?? "",
    stateCookie: cookieValue(res, "il_oauth_state") ?? "",
  };
}

async function callback(query: Record<string, string>, cookie?: string) {
  const qs = new URLSearchParams(query).toString();
  return app.request(`${BASE}/auth/github/callback?${qs}`, cookie ? { headers: { cookie } } : {});
}

/** Full sign-in through the stub; returns the session cookie pair `il_session=...`. */
async function signIn(): Promise<string> {
  const { state, stateCookie } = await startSignIn();
  const res = await callback({ code: stub.issueCode(), state }, stateCookie);
  expect(res.status).toBe(302);
  const session = cookieValue(res, "il_session");
  if (!session) throw new Error("no session cookie");
  return session;
}

describe("start sign-in (AC 2)", () => {
  test("redirects to GitHub authorize with client_id, random state, scope read:user only", async () => {
    const a = await startSignIn();
    const b = await startSignIn();
    expect(a.res.status).toBe(302);
    expect(`${a.location.origin}${a.location.pathname}`).toBe(`${stub.url}/login/oauth/authorize`);
    expect(a.location.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(a.location.searchParams.get("scope")).toBe("read:user");
    expect(a.state.length).toBeGreaterThanOrEqual(32);
    expect(a.state).not.toBe(b.state);
    const raw = cookiesOf(a.res).find((c) => c.startsWith("il_oauth_state=")) ?? "";
    expect(raw).toMatch(/HttpOnly/);
    expect(raw).toMatch(/SameSite=Lax/);
    expect(raw).toMatch(/Max-Age=600/);
  });
});

describe("callback (AC 3)", () => {
  test("valid code + state upserts user, sets session cookie, redirects to /ladders", async () => {
    const { state, stateCookie } = await startSignIn();
    const res = await callback({ code: stub.issueCode(), state }, stateCookie);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/ladders");
    const raw = cookiesOf(res).find((c) => c.startsWith("il_session=")) ?? "";
    expect(raw).toMatch(/HttpOnly/);
    expect(raw).toMatch(/SameSite=Lax/);
    expect(raw).not.toMatch(/Secure/); // NODE_ENV=test is local
    const rows = await db.sql`SELECT github_id::text AS github_id, github_login FROM users`;
    expect(rows).toEqual([{ github_id: "42", github_login: "octo" }]);

    const session = cookieValue(res, "il_session") ?? "";
    const ladders = await app.request(`${BASE}/ladders`, { headers: { cookie: session } });
    expect(ladders.status).toBe(200);
    expect(await ladders.text()).toContain("fixture client");
    const me = await app.request(`${BASE}/api/me`, { headers: { cookie: session } });
    expect(await me.json()).toEqual({ login: "octo" });
  });

  test("session cookie is Secure outside local dev", async () => {
    const prodApp = createApp({
      config: { ...config, secureCookies: true },
      sql: db.sql,
      clientDir: "tests/fixtures/client",
    });
    const start = await prodApp.request(`${BASE}/auth/github`);
    const state = new URL(start.headers.get("location") ?? "").searchParams.get("state") ?? "";
    const res = await prodApp.request(`${BASE}/auth/github/callback?code=${stub.issueCode()}&state=${state}`, {
      headers: { cookie: cookieValue(start, "il_oauth_state") ?? "" },
    });
    expect(cookiesOf(res).find((c) => c.startsWith("il_session=")) ?? "").toMatch(/Secure/);
    expect(cookiesOf(start).find((c) => c.startsWith("il_oauth_state=")) ?? "").toMatch(/Secure/);
  });
});

describe("callback negatives (AC 4)", () => {
  async function expectRejected(res: Response) {
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Sign-in failed");
    expect(cookieValue(res, "il_session")).toBeUndefined();
    expect(await userCount()).toBe(0);
    expect(await sessionCount()).toBe(0);
  }

  test("mismatched state", async () => {
    const { stateCookie } = await startSignIn();
    await expectRejected(await callback({ code: stub.issueCode(), state: "a".repeat(43) }, stateCookie));
  });

  test("missing state query", async () => {
    const { stateCookie } = await startSignIn();
    await expectRejected(await callback({ code: stub.issueCode() }, stateCookie));
  });

  test("missing state cookie", async () => {
    const { state } = await startSignIn();
    await expectRejected(await callback({ code: stub.issueCode(), state }));
  });

  test("tampered state cookie", async () => {
    const { state, stateCookie } = await startSignIn();
    const tampered = stateCookie.replace(/\.(\d+)\./, (_m, t) => `.${Number(t) + 1}.`);
    await expectRejected(await callback({ code: stub.issueCode(), state }, tampered));
  });

  test("expired state cookie (older than 10 minutes)", async () => {
    const { state, stateCookie } = await startSignIn();
    clock += 601_000;
    await expectRejected(await callback({ code: stub.issueCode(), state }, stateCookie));
  });

  test("failed token exchange", async () => {
    const { state, stateCookie } = await startSignIn();
    await expectRejected(await callback({ code: "never-issued", state }, stateCookie));
  });

  test("GitHub error=access_denied shows a friendly page", async () => {
    const { state, stateCookie } = await startSignIn();
    const res = await callback({ error: "access_denied", state }, stateCookie);
    await expectRejected(res);
  });

  test("replayed code + state fails the second time; one session only", async () => {
    const { state, stateCookie } = await startSignIn();
    const code = stub.issueCode();
    expect((await callback({ code, state }, stateCookie)).status).toBe(302);
    const replay = await callback({ code, state }, stateCookie);
    expect(replay.status).toBe(400);
    expect(cookieValue(replay, "il_session")).toBeUndefined();
    expect(await sessionCount()).toBe(1);
  });

  test("callback clears the state cookie", async () => {
    const { state, stateCookie } = await startSignIn();
    const res = await callback({ code: stub.issueCode(), state }, stateCookie);
    expect(cookiesOf(res).find((c) => c.startsWith("il_oauth_state=")) ?? "").toMatch(/Max-Age=0/);
  });
});

describe("identity by github_id (AC 5)", () => {
  test("renamed login: still one row, login updated", async () => {
    await signIn();
    stub.setUser({ id: 42, login: "octo-renamed" });
    await signIn();
    const rows = await db.sql`SELECT github_id::text AS github_id, github_login FROM users`;
    expect(rows).toEqual([{ github_id: "42", github_login: "octo-renamed" }]);
  });

  test("two accounts: two rows, each session sees only its own user", async () => {
    const a = await signIn();
    stub.setUser({ id: 43, login: "other" });
    const b = await signIn();
    expect(await userCount()).toBe(2);
    expect(await (await app.request(`${BASE}/api/me`, { headers: { cookie: a } })).json()).toEqual({ login: "octo" });
    expect(await (await app.request(`${BASE}/api/me`, { headers: { cookie: b } })).json()).toEqual({ login: "other" });
  });
});

describe("session guard and sign-out (AC 6)", () => {
  test("signed out, GET /ladders redirects to /", async () => {
    const res = await app.request(`${BASE}/ladders`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
  });

  test("forged session cookie does not open /ladders", async () => {
    const res = await app.request(`${BASE}/ladders`, { headers: { cookie: "il_session=forged" } });
    expect(res.status).toBe(302);
    expect((await app.request(`${BASE}/api/me`, { headers: { cookie: "il_session=forged" } })).status).toBe(401);
  });

  test("expired session does not open /ladders", async () => {
    const session = await signIn();
    await db.sql`UPDATE sessions SET expires_at = now() - interval '1 second'`;
    expect((await app.request(`${BASE}/ladders`, { headers: { cookie: session } })).status).toBe(302);
  });

  test("after sign-out the old cookie no longer opens /ladders", async () => {
    const session = await signIn();
    const out = await app.request(`${BASE}/auth/sign-out`, { method: "POST", headers: { cookie: session } });
    expect(out.status).toBe(303);
    expect(out.headers.get("location")).toBe("/");
    expect(cookiesOf(out).find((c) => c.startsWith("il_session=")) ?? "").toMatch(/Max-Age=0/);
    expect(await sessionCount()).toBe(0);
    const res = await app.request(`${BASE}/ladders`, { headers: { cookie: session } });
    expect(res.status).toBe(302);
  });

  test("home: signed out serves the client, signed in redirects to /ladders", async () => {
    const out = await app.request(`${BASE}/`);
    expect(out.status).toBe(200);
    expect(await out.text()).toContain("fixture client");
    const session = await signIn();
    const res = await app.request(`${BASE}/`, { headers: { cookie: session } });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/ladders");
  });

  test("session token is not stored in the database in clear", async () => {
    const session = await signIn();
    const token = session.split("=")[1] ?? "";
    const rows = await db.sql`SELECT id FROM sessions`;
    expect(rows[0].id).not.toBe(token);
    expect(rows[0].id).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("security headers", () => {
  test("pages cannot be framed and content types are not sniffed", async () => {
    const res = await app.request(`${BASE}/`);
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("Cache-Control: no-store on private and auth responses", () => {
  test("/api/me, /ladders and /auth routes are not cacheable", async () => {
    const session = await signIn();
    const { state, stateCookie } = await startSignIn();
    const responses = {
      "/api/me signed in": await app.request(`${BASE}/api/me`, { headers: { cookie: session } }),
      "/api/me signed out": await app.request(`${BASE}/api/me`),
      "/ladders signed in": await app.request(`${BASE}/ladders`, { headers: { cookie: session } }),
      "/ladders signed out": await app.request(`${BASE}/ladders`),
      "/auth/github": await app.request(`${BASE}/auth/github`),
      "/auth/github/callback ok": await callback({ code: stub.issueCode(), state }, stateCookie),
      "/auth/github/callback failed": await callback({ code: "bad", state: "bad" }),
      "/auth/sign-out": await app.request(`${BASE}/auth/sign-out`, { method: "POST", headers: { cookie: session } }),
    };
    for (const [name, res] of Object.entries(responses)) {
      expect(`${name}: ${res.headers.get("cache-control")}`).toBe(`${name}: no-store`);
    }
  });
});
