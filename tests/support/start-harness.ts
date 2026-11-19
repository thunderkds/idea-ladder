// Shared setup for the /start and /api/jobs tests: test DB, app with recorded GitHub fixtures and an enqueue spy.

import { createApp } from "../../src/server/app.ts";
import { signInUser } from "../../src/server/auth.ts";
import { type Config, loadConfig } from "../../src/server/config.ts";
import type { RegenerateRequested } from "../../src/server/flags.ts";
import { githubRepoClient } from "../../src/server/github-repo.ts";
import type { GenerateRequested } from "../../src/server/ladder-generate.ts";
import { migrateUp } from "../../src/server/migrate.ts";
import { createTestDatabase } from "./db.ts";
import { type Fixture, fixtureFetch, loadFixture, type Override, V0_REPOS } from "./github-fixtures.ts";

export const BASE = "http://localhost";
export const SECRET = "x".repeat(48);

export async function startHarness(extraEnv: Record<string, string> = {}) {
  const db = await createTestDatabase();
  await migrateUp(db.sql);
  const fixtures: Fixture[] = await Promise.all(
    Object.keys(V0_REPOS).map((r) => loadFixture(r as keyof typeof V0_REPOS)),
  );
  const state = {
    override: undefined as Override | undefined,
    sent: [] as GenerateRequested[],
    regenerate: [] as RegenerateRequested[],
    enqueueFails: false,
    regenerateFails: false,
  };
  const gh = fixtureFetch(fixtures, (path) => state.override?.(path));
  const config: Config = loadConfig({
    DATABASE_URL: db.url,
    GITHUB_CLIENT_ID: "test-client-id",
    GITHUB_CLIENT_SECRET: "test-client-secret",
    GITHUB_APP_TOKEN: "test-app-token",
    SESSION_SECRET: SECRET,
    ANTHROPIC_API_KEY: "sk-ant-test",
    MODEL_A_ID: "test-model",
    NODE_ENV: "test",
    ...extraEnv,
  });
  const app = createApp({
    config,
    sql: db.sql,
    clientDir: "tests/fixtures/client",
    github: githubRepoClient({ baseUrl: config.githubApiBaseUrl, token: config.githubAppToken, fetch: gh.impl }),
    enqueueRegenerate: async (data) => {
      if (state.regenerateFails) throw new Error("Inngest unreachable");
      state.regenerate.push(data);
    },
    enqueue: async (data) => {
      if (state.enqueueFails) throw new Error("Inngest unreachable");
      state.sent.push(data);
    },
  });

  let nextGithubId = 1000;
  /** A signed-in learner: returns the `il_session=...` cookie pair. */
  async function learner(): Promise<string> {
    const n = nextGithubId++;
    return `il_session=${await signInUser(db.sql, SECRET, { id: n, login: `learner${n}` })}`;
  }

  const post = (url: unknown, cookie?: string) =>
    app.request(`${BASE}/api/start`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify({ url }),
    });
  const get = (path: string, cookie?: string) => app.request(`${BASE}${path}`, cookie ? { headers: { cookie } } : {});

  async function reset() {
    await db.sql`TRUNCATE ladders, generation_jobs, repo_snapshots CASCADE`;
    state.override = undefined;
    state.sent.length = 0;
    state.regenerate.length = 0;
    state.enqueueFails = false;
    state.regenerateFails = false;
    gh.calls.length = 0;
  }

  const count = async (table: "generation_jobs" | "ladders" | "repo_snapshots") =>
    Number((await db.sql`SELECT count(*)::int AS n FROM ${db.sql(table)}`)[0].n);

  return { db, app, config, state, gh, learner, post, get, reset, count };
}
