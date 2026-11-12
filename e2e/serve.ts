// e2e web server: fresh database, migrated; GitHub OAuth stub; the app serving the built client.
// T005: the repo API replays recorded fixtures, and the Inngest function runs in-process through @inngest/test
// (no Inngest dev server, no network). The real dev-server run is a manual check for the owner.
import { InngestTestEngine } from "@inngest/test";
import { SQL } from "bun";
import { createApp } from "../src/server/app.ts";
import { loadConfig } from "../src/server/config.ts";
import { type GithubRepoClient, githubRepoClient } from "../src/server/github-repo.ts";
import { createInngest, LADDER_GENERATE_EVENT, ladderGenerateFunction } from "../src/server/ladder-generate.ts";
import { migrateUp } from "../src/server/migrate.ts";
import { adminUrl } from "../tests/support/db.ts";
import { fixtureFetch, loadFixture, rateLimited, V0_REPOS, type V0Repo } from "../tests/support/github-fixtures.ts";
import { startGithubStub } from "../tests/support/github-stub.ts";

export const APP_PORT = 54401;
const STUB_PORT = 54400;
const DB_NAME = "il_e2e";

const admin = new SQL(adminUrl);
await admin.unsafe(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
await admin.unsafe(`CREATE DATABASE "${DB_NAME}"`);
await admin.close();
const dbUrl = new URL(adminUrl);
dbUrl.pathname = `/${DB_NAME}`;
const sql = new SQL(dbUrl.toString());
await migrateUp(sql);

const stub = startGithubStub({
  user: { id: 42, login: "octo" },
  clientId: "e2e-client-id",
  clientSecret: "e2e-client-secret",
  callbackUrl: `http://localhost:${APP_PORT}/auth/github/callback`,
  port: STUB_PORT,
});
const config = loadConfig({
  DATABASE_URL: dbUrl.toString(),
  GITHUB_CLIENT_ID: "e2e-client-id",
  GITHUB_CLIENT_SECRET: "e2e-client-secret",
  GITHUB_APP_TOKEN: "e2e-app-token",
  SESSION_SECRET: crypto.randomUUID() + crypto.randomUUID(),
  GITHUB_OAUTH_BASE_URL: stub.url,
  GITHUB_API_BASE_URL: stub.url,
  NODE_ENV: "test",
  PORT: String(APP_PORT),
});

// Repo behaviour per e2e scenario (e2e/start-flow.e2e.ts).
const QUEUE_DELAY_MS = 2_500; // the job shows "Queued" first
const STEP_DELAY_MS = 6_000; // then "Reading the repo", long enough to screenshot
const HELD_REPO = "the-pocket/pocketflow"; // never picked up: stays "Queued"
const RATE_LIMITED_REPO = "developit/mitt"; // fetch-repo hits the rate limit
const RESET_EPOCH_S = Date.UTC(2030, 0, 1, 12) / 1000;

const fixtures = await Promise.all(Object.keys(V0_REPOS).map((r) => loadFixture(r as V0Repo)));
const gh = fixtureFetch(fixtures, (path) =>
  path.startsWith(`/repos/${RATE_LIMITED_REPO}`) && !path.endsWith("/commits?per_page=1")
    ? rateLimited(RESET_EPOCH_S)
    : undefined,
);
const fixtureClient = githubRepoClient({ baseUrl: stub.url, token: "e2e-app-token", fetch: gh.impl });
const github: GithubRepoClient = {
  ...fixtureClient,
  fetchSnapshot: async (repo, sha) => {
    await Bun.sleep(STEP_DELAY_MS);
    return fixtureClient.fetchSnapshot(repo, sha);
  },
};
const fn = ladderGenerateFunction(createInngest(), { sql, github });

const app = createApp({
  config,
  sql,
  clientDir: "dist/client",
  github,
  enqueue: async (data) => {
    if (data.repo === HELD_REPO) return;
    setTimeout(() => {
      new InngestTestEngine({ function: fn, events: [{ name: LADDER_GENERATE_EVENT, data }] })
        .execute()
        .catch((err) => console.error("e2e: in-process Inngest run failed:", err));
    }, QUEUE_DELAY_MS);
  },
});
Bun.serve({ port: APP_PORT, fetch: app.fetch });
console.log(`e2e server on http://localhost:${APP_PORT} (stub GitHub ${stub.url})`);
