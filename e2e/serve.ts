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

// T010 seeds (e2e/ladder-view.e2e.ts). Repos differ from the start-flow ones, so /start there never hits a cache.
// Level rows come from T008 later; here they are inserted directly. Passes belong to T012, so klona's L0 and L1 are
// reported as passed through the app's `passedLevels` seam.
const SEED_SHA = "6b41670516ed8e8b738612f60491995470aa63b3";
const LONG_GOAL = `${"Explain how the core loop works end to end, ".repeat(6)}https://example.com/${"x".repeat(120)}`;
const LEVELS: [id: string, title: string, goal: string, kind: string, test: string][] = [
  ["L0", "Prerequisites", "Learn the concepts you are missing", "concept-ladder-tests", "Concept ladder tests"],
  ["L1", "Run it", "Clone the repo and run it", "run-evidence", "Screenshot or log + 3-sentence explanation"],
  [
    "L2",
    "Modify",
    "Change one small thing",
    "diff-questions",
    "Branch or diff link + questions generated from your diff",
  ],
  ["L3", "Understand", LONG_GOAL, "core-mcq", "Verified MCQs on core files"],
  ["L4", "Rebuild or contribute", "Rebuild a minimal version", "repo-or-pr-link", "Repo link or PR link"],
];
async function seedLadder(repo: string, sha: string, withLevels: boolean, startedBy?: string) {
  const [row] =
    await sql`INSERT INTO ladders (repo_full_name, commit_sha, status) VALUES (${repo}, ${sha}, 'unverified') RETURNING id::text AS id`;
  if (withLevels) {
    for (const [level, title, goal, kind, test] of LEVELS) {
      await sql`INSERT INTO ladder_levels (ladder_id, level, title, goal, pass_test_kind, pass_test_description) VALUES (${row.id}, ${level}, ${title}, ${goal}, ${kind}, ${test})`;
    }
  }
  if (startedBy) {
    await sql`INSERT INTO generation_jobs (repo_full_name, commit_sha, status, started_by) VALUES (${repo}, ${sha}, 'fetched', ${startedBy})`;
  }
  return row.id as string;
}
// A second learner owns the jobs behind "My ladders", so octo's page stays empty for the sign-in e2e.
const [reader] = await sql`INSERT INTO users (github_id, github_login) VALUES (43, 'reader') RETURNING id::text AS id`;
const seeded = {
  next: await seedLadder("vercel/next.js", SEED_SHA, true, reader.id),
  klona: await seedLadder("lukeed/klona", "2f3c9d1e8a7b4c5d6e7f8091a2b3c4d5e6f70812", true, reader.id),
  plain: await seedLadder("sindresorhus/p-map", "3".repeat(40), false),
};

// T011 seeds (e2e/review.e2e.ts). octo keeps no ladders (the sign-in e2e expects "No ladders yet"), so octo is the
// "No cards yet" learner. `reviewer` has 3 New (due now) cards in open L0 and 2 in locked L1 (no passes). `waiter` has
// one card already rated and due at a fixed future time: "Nothing due" with a next due time.
const [reviewer] =
  await sql`INSERT INTO users (github_id, github_login) VALUES (44, 'reviewer') RETURNING id::text AS id`;
const [waiter] = await sql`INSERT INTO users (github_id, github_login) VALUES (45, 'waiter') RETURNING id::text AS id`;
const seedCard = async (ladderId: string, level: string, front: string, back: string) =>
  (
    await sql`INSERT INTO review_cards (ladder_id, level, front, back) VALUES (${ladderId}, ${level}, ${front}, ${back}) RETURNING id::text AS id`
  )[0].id as string;
const reviewLadder = await seedLadder("tj/commander.js", "4".repeat(40), true, reviewer.id);
const waiterLadder = await seedLadder("vercel/ms", "5".repeat(40), true, waiter.id);
const WAITER_DUE = "2030-01-02T09:00:00.000Z";
const reviewSeeds = {
  reviewer: { githubId: 44, login: "reviewer" },
  waiter: { githubId: 45, login: "waiter", nextDueAt: WAITER_DUE },
  ladderId: reviewLadder,
  openCards: [
    await seedCard(reviewLadder, "L0", "What does a command's action handler receive?", "Its arguments, then options."),
    await seedCard(reviewLadder, "L0", "Where are global options parsed?", "On the root program, before subcommands."),
    await seedCard(reviewLadder, "L0", "What runs when no subcommand matches?", "The default command, if one is set."),
  ],
  lockedCards: [
    await seedCard(reviewLadder, "L1", "Locked card one", "Hidden until L0 is passed."),
    await seedCard(reviewLadder, "L1", "Locked card two", "Hidden until L0 is passed."),
  ],
  waiterCard: await seedCard(waiterLadder, "L0", "What does ms('1h') return?", "3600000."),
};
/** Back to the seeded review state: every rating forgotten (TRUNCATE: the log rejects DELETE), waiter's card due later. */
async function resetReview() {
  await sql`TRUNCATE review_log, card_states`;
  await sql`INSERT INTO card_states (learner_id, card_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review)
    VALUES (${waiter.id}, ${reviewSeeds.waiterCard}, ${WAITER_DUE}, 10, 5, 0, 10, 0, 1, 0, 2, '2029-12-23T09:00:00Z')`;
}
await resetReview();

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
  passedLevels: async (ladderId) => (ladderId === seeded.klona ? ["L0", "L1"] : []),
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
Bun.serve({ hostname: "127.0.0.1", port: APP_PORT, fetch: app.fetch });
console.log(`e2e server on http://localhost:${APP_PORT} (stub GitHub ${stub.url})`);

// Test-only control port: the seeded ladder ids, and a switch for who the GitHub stub signs in.
Bun.serve({
  hostname: "127.0.0.1",
  port: APP_PORT + 1,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/ladders") return Response.json(seeded);
    if (url.pathname === "/review-seeds") return Response.json(reviewSeeds);
    if (url.pathname === "/reset-review") return resetReview().then(() => new Response("ok"));
    if (url.pathname === "/set-user") {
      stub.setUser({ id: Number(url.searchParams.get("id")), login: url.searchParams.get("login") ?? "octo" });
      return new Response("ok");
    }
    return new Response("not found", { status: 404 });
  },
});
