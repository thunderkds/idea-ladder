// T013: the artifact and L1 feedback routes (server handlers for the T030 screens).
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/server/app.ts";
import type { ArtifactEvent } from "../src/server/artifacts.ts";
import { signInUser } from "../src/server/auth.ts";
import { loadConfig } from "../src/server/config.ts";
import { githubRepoClient } from "../src/server/github-repo.ts";
import { migrateUp } from "../src/server/migrate.ts";
import { createTestDatabase } from "./support/db.ts";
import { fixtureFetch, type Override, rateLimited } from "./support/github-fixtures.ts";
import { FORK, HEAD, LEARNER, MERGE, PINNED, t013Fixture, UPSTREAM } from "./support/t013-github.ts";

const SECRET = "x".repeat(48);
let db: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
const state = {
  override: undefined as Override | undefined,
  events: [] as ArtifactEvent[],
  emitFails: false,
  auth: [] as (string | null)[],
};
const gh = fixtureFetch([t013Fixture()], (path) => state.override?.(path));

beforeAll(async () => {
  db = await createTestDatabase();
  await migrateUp(db.sql);
  const config = loadConfig({
    DATABASE_URL: db.url,
    GITHUB_CLIENT_ID: "id",
    GITHUB_CLIENT_SECRET: "secret",
    GITHUB_APP_TOKEN: "test-app-token",
    SESSION_SECRET: SECRET,
    ANTHROPIC_API_KEY: "sk-ant-test",
    MODEL_A_ID: "test-model",
    NODE_ENV: "test",
  });
  app = createApp({
    config,
    sql: db.sql,
    clientDir: "tests/fixtures/client",
    github: githubRepoClient({
      baseUrl: config.githubApiBaseUrl,
      token: config.githubAppToken,
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        state.auth.push(new Headers(init?.headers).get("authorization"));
        return await gh.impl(input, init);
      }) as typeof fetch,
    }),
    passedLevels: async () => ["L0", "L1", "L2", "L3"],
    emitArtifact: async (e) => {
      if (state.emitFails) throw new Error("Inngest unreachable");
      state.events.push(e);
    },
  });
});
afterAll(async () => {
  await db.drop();
});
beforeEach(async () => {
  await db.sql`TRUNCATE artifacts, run_feedback, evidence_records, ladders, repo_snapshots, users CASCADE`;
  state.override = undefined;
  state.events.length = 0;
  state.emitFails = false;
  state.auth.length = 0;
  gh.calls.length = 0;
});

async function seed() {
  const cookie = `il_session=${await signInUser(db.sql, SECRET, { id: LEARNER.githubId, login: LEARNER.login })}`;
  await db.sql`INSERT INTO repo_snapshots (repo_full_name, commit_sha, default_branch, archived, readme, topics, languages, dep_files, open_issues, good_first_issues, tree, tree_truncated)
    VALUES (${UPSTREAM.fullName}, ${PINNED}, 'main', false, 'r', '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, 0, 0, '[]'::jsonb, false)`;
  const [l] = await db.sql`
    INSERT INTO ladders (repo_full_name, commit_sha, status) VALUES (${UPSTREAM.fullName}, ${PINNED}, 'unverified') RETURNING id::text AS id`;
  return { cookie, ladderId: l.id as string };
}
const post = (path: string, cookie: string | undefined, body: unknown) =>
  app.request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const artifactPath = (ladderId: string, level: string) => `/api/ladders/${ladderId}/levels/${level}/artifact`;
const BRANCH_URL = `https://github.com/${FORK.fullName}/tree/feature/retry`;
const PR_URL = `https://github.com/${UPSTREAM.fullName}/pull/42`;

describe("T013 artifact routes", () => {
  test("L2: 200 with the artifact, no-store; the event is sent", async () => {
    const { cookie, ladderId } = await seed();
    const res = await post(artifactPath(ladderId, "L2"), cookie, { url: BRANCH_URL });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ artifact: { level: "L2", url: BRANCH_URL, headSha: HEAD } });
    expect(state.events).toHaveLength(1);
  });

  test("L4: 200 with the artifact and the evidence record", async () => {
    const { cookie, ladderId } = await seed();
    const res = await post(artifactPath(ladderId, "L4"), cookie, { url: PR_URL });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      artifact: { level: "L4", kind: "pr", headSha: MERGE },
      evidence: { level: "L4", test: "artifact" },
    });
  });

  test("401 without a session; 404 for L1/L3 or an unknown ladder; 400 for a bad body or URL; 422 with a reason", async () => {
    const { cookie, ladderId } = await seed();
    expect((await post(artifactPath(ladderId, "L2"), undefined, { url: BRANCH_URL })).status).toBe(401);
    for (const level of ["L1", "L3", "L9"]) {
      const res = await post(artifactPath(ladderId, level), cookie, { url: BRANCH_URL });
      expect([res.status, await res.json()]).toEqual([404, { error: "not-found" }]);
    }
    expect((await post(artifactPath("999999", "L2"), cookie, { url: BRANCH_URL })).status).toBe(404);
    const notJson = await post(artifactPath(ladderId, "L2"), cookie, "{");
    expect([notJson.status, await notJson.json()]).toEqual([400, { error: "invalid-url" }]);
    const http = await post(artifactPath(ladderId, "L2"), cookie, { url: "http://github.com/a/b/tree/main" });
    expect([http.status, await http.json()]).toEqual([400, { error: "invalid-url" }]);
    const open = await post(artifactPath(ladderId, "L4"), cookie, {
      url: `https://github.com/${UPSTREAM.fullName}/pull/43`,
    });
    expect([open.status, await open.json()]).toEqual([422, { error: "artifact-rejected", reason: "not-found" }]);
    expect(gh.calls.every((c) => c.startsWith("/repos/"))).toBe(true);
  });

  test("a GitHub rate limit: 503 with retryAt; the event queue down: 503 queue-unavailable", async () => {
    const { cookie, ladderId } = await seed();
    state.override = (path) => (path.includes("/branches/") ? rateLimited(1_900_000_000) : undefined);
    const limited = await post(artifactPath(ladderId, "L2"), cookie, { url: BRANCH_URL });
    expect([limited.status, await limited.json()]).toEqual([
      503,
      { error: "rate-limited", retryAt: new Date(1_900_000_000_000).toISOString() },
    ]);
    state.override = undefined;
    state.emitFails = true;
    const down = await post(artifactPath(ladderId, "L2"), cookie, { url: BRANCH_URL });
    expect([down.status, await down.json()]).toEqual([503, { error: "queue-unavailable" }]);
  });

  test("a client-sent token or authorization header is never forwarded: every GitHub call carries the app token", async () => {
    const { cookie, ladderId } = await seed();
    const res = await app.request(`http://localhost${artifactPath(ladderId, "L2")}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, authorization: "Bearer client-token" },
      body: JSON.stringify({ url: BRANCH_URL, token: "client-token" }),
    });
    expect(res.status).toBe(200);
    expect(state.auth.length).toBeGreaterThan(0);
    expect(new Set(state.auth)).toEqual(new Set(["Bearer test-app-token"]));
    expect(gh.calls.filter((c) => c.includes("client-token"))).toEqual([]);
  });
});

describe("T013 L1 run feedback route (AC 6: feedback only)", () => {
  const path = (ladderId: string) => `/api/ladders/${ladderId}/levels/L1/run-feedback`;
  test("saves a 3-sentence explanation and an optional run log; a second save replaces it; no evidence record", async () => {
    const { cookie, ladderId } = await seed();
    const first = await post(path(ladderId), cookie, { explanation: "It starts. It listens. It logs." });
    expect([first.status, await first.json()]).toEqual([200, { ok: true }]);
    const second = await post(path(ladderId), cookie, { runLog: "listening on 3000", explanation: "A. B. C." });
    expect(second.status).toBe(200);
    expect(await db.sql`SELECT run_log, explanation FROM run_feedback`).toEqual([
      { run_log: "listening on 3000", explanation: "A. B. C." },
    ]);
    expect((await db.sql`SELECT count(*)::int AS n FROM evidence_records`)[0].n).toBe(0);
  });

  test("401 without a session; 422 for 2 sentences; 404 for an unknown ladder", async () => {
    const { cookie, ladderId } = await seed();
    expect((await post(path(ladderId), undefined, { explanation: "A. B. C." })).status).toBe(401);
    const two = await post(path(ladderId), cookie, { explanation: "A. B." });
    expect([two.status, await two.json()]).toEqual([422, { error: "explanation-not-3-sentences" }]);
    expect((await post(path("999999"), cookie, { explanation: "A. B. C." })).status).toBe(404);
    expect((await post(path("x"), cookie, { explanation: "A. B. C." })).status).toBe(404);
  });
});
