// T013 AC 1, 2, 4, 5 and Success Criteria 1, 2, 5, 7: verifyL2Branch against GitHub-shaped fixtures (no network).
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  type ArtifactEvent,
  type ArtifactReason,
  L2_ARTIFACT_EVENT,
  MAX_L2_COMMITS,
  verifyL2Branch,
} from "../src/server/artifacts.ts";
import { evidencePassedLevels } from "../src/server/evidence.ts";
import { githubRepoClient } from "../src/server/github-repo.ts";
import { migrateUp } from "../src/server/migrate.ts";
import { levelLockState } from "../src/shared/levels.ts";
import { createTestDatabase } from "./support/db.ts";
import { type FixtureEntry, fixtureFetch, rateLimited } from "./support/github-fixtures.ts";
import { commit, FORK, HEAD, json, LEARNER, OTHER, PINNED, t013Fixture, UPSTREAM } from "./support/t013-github.ts";

let db: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => {
  db = await createTestDatabase();
  await migrateUp(db.sql);
});
afterAll(async () => {
  await db.drop();
});
beforeEach(async () => {
  await db.sql`TRUNCATE artifacts, evidence_records, ladders, repo_snapshots, users CASCADE`;
});

const URL_OK = `https://github.com/${FORK.fullName}/tree/feature/retry`;
const COMPARE = `/repos/${FORK.fullName}/compare/${PINNED}...${HEAD}?per_page=100&page=1`;
const NOW = new Date("2026-11-19T12:00:00Z");
const L0_L1 = async () => ["L0", "L1"];

/** The learner (github id 501) and a ladder on the upstream repo at PINNED. */
async function seed(repo = UPSTREAM.fullName) {
  const [u] = await db.sql`
    INSERT INTO users (github_id, github_login) VALUES (${LEARNER.githubId}, ${LEARNER.login}) RETURNING id::text AS id`;
  await db.sql`INSERT INTO repo_snapshots (repo_full_name, commit_sha, default_branch, archived, readme, topics, languages, dep_files, open_issues, good_first_issues, tree, tree_truncated)
    VALUES (${repo}, ${PINNED}, 'main', false, 'r', '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, 0, 0, '[]'::jsonb, false)`;
  const [l] = await db.sql`
    INSERT INTO ladders (repo_full_name, commit_sha, status) VALUES (${repo}, ${PINNED}, 'unverified') RETURNING id::text AS id`;
  return { userId: u.id as string, ladderId: l.id as string };
}

function deps(over: Record<string, FixtureEntry> = {}, override?: Parameters<typeof fixtureFetch>[1]) {
  const fx = fixtureFetch([t013Fixture(over)], override);
  const events: ArtifactEvent[] = [];
  return {
    fx,
    events,
    deps: {
      sql: db.sql,
      github: githubRepoClient({ baseUrl: "https://api.github.com", token: "app-token", fetch: fx.impl }),
      passedLevels: L0_L1,
      emit: async (e: ArtifactEvent) => {
        events.push(e);
      },
      now: () => NOW,
    },
  };
}
const rows = async () =>
  await db.sql`SELECT level, kind, url, repo_full_name, head_sha, verified_at FROM artifacts ORDER BY id`;
const evidenceCount = async () => (await db.sql`SELECT count(*)::int AS n FROM evidence_records`)[0].n;
const compareWith = (commits: unknown[], files: unknown[] = [{ filename: "a.ts" }]) => ({
  [COMPARE]: json({ total_commits: commits.length, commits, files }),
});

describe("T013 verifyL2Branch: a pass (AC 1, AC 2, Success Criterion 1)", () => {
  test("fork branch with 2 commits by the learner's id: artifact row, 40-hex headSha, event emitted, no evidence, L3 locked", async () => {
    const { userId, ladderId } = await seed();
    const d = deps();
    const result = await verifyL2Branch(d.deps, userId, ladderId, URL_OK);
    expect(result).toEqual({
      artifact: {
        id: expect.any(String),
        level: "L2",
        kind: "branch",
        url: URL_OK,
        repo: FORK.fullName,
        headSha: HEAD,
        verifiedAt: NOW.toISOString(),
      },
    });
    expect(await rows()).toEqual([
      { level: "L2", kind: "branch", url: URL_OK, repo_full_name: FORK.fullName, head_sha: HEAD, verified_at: NOW },
    ]);
    const artifactId = (result as { artifact: { id: string } }).artifact.id;
    expect(d.events).toEqual([
      {
        id: `l2-artifact-${artifactId}`,
        name: L2_ARTIFACT_EVENT,
        data: { artifactId, learnerId: userId, ladderId, repo: FORK.fullName, baseSha: PINNED, headSha: HEAD },
      },
    ]);
    expect(await evidenceCount()).toBe(0);
    expect(levelLockState(await evidencePassedLevels(db.sql)(ladderId, userId))[3]).toBe("locked");
  });

  test("a branch in the ladder repo itself passes; a renamed ladder repo is matched by id", async () => {
    const { userId, ladderId } = await seed("old-org/proj"); // GitHub now answers the upstream repo for this name
    const upstream = JSON.parse(t013Fixture().entries[`/repos/${UPSTREAM.fullName}`]?.body as string);
    const d = deps({ "/repos/old-org/proj": json(upstream) });
    expect(await verifyL2Branch(d.deps, userId, ladderId, URL_OK)).toHaveProperty("artifact.headSha", HEAD);
  });

  test("the same URL at the same head twice: one row; the event repeats with the same id (Inngest dedupes)", async () => {
    const { userId, ladderId } = await seed();
    const d = deps();
    const a = await verifyL2Branch(d.deps, userId, ladderId, URL_OK);
    const b = await verifyL2Branch(d.deps, userId, ladderId, URL_OK);
    expect(b).toEqual(a);
    expect(await rows()).toHaveLength(1);
    const ids = d.events.map((e) => e.id);
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0] as string);
  });

  test("the event cannot be sent: 503 queue-unavailable; the row is kept and a retry sends the same event", async () => {
    const { userId, ladderId } = await seed();
    const d = deps();
    const failing = { ...d.deps, emit: async () => Promise.reject(new Error("inngest down")) };
    expect(await verifyL2Branch(failing, userId, ladderId, URL_OK)).toEqual({
      status: 503,
      error: "queue-unavailable",
    });
    expect(await rows()).toHaveLength(1);
    await verifyL2Branch(d.deps, userId, ladderId, URL_OK);
    expect(d.events).toHaveLength(1);
  });
});

describe("T013 verifyL2Branch: rejections store nothing (AC 1, AC 4, AC 5, Success Criteria 2, 5, 7)", () => {
  const rejected = (reason: string) =>
    ({ status: 422, error: "artifact-rejected", reason: reason as ArtifactReason }) as const;
  const cases: [string, Record<string, FixtureEntry>, string][] = [
    [
      "one commit by another account with the learner's email",
      compareWith([commit("5".repeat(40), LEARNER.githubId), commit(HEAD, OTHER.githubId)]),
      "author-mismatch",
    ],
    ["a commit whose email links no account (author null)", compareWith([commit(HEAD, null)]), "author-mismatch"],
    ["only commits already in the pinned SHA", compareWith([]), "no-new-commits"],
    ["commits but an empty diff", compareWith([commit(HEAD, LEARNER.githubId)], []), "no-new-commits"],
    [
      "more than the maximum commits",
      { [COMPARE]: json({ total_commits: MAX_L2_COMMITS + 1, commits: [], files: [{}] }) },
      "range-too-large",
    ],
    ["a missing branch", { [`/repos/${FORK.fullName}/branches/feature/retry`]: json({}, 404) }, "not-found"],
    ["a missing repo", { [`/repos/${FORK.fullName}`]: json({}, 404) }, "not-found"],
    [
      "a private repo",
      {
        [`/repos/${FORK.fullName}`]: json({
          id: FORK.id,
          full_name: FORK.fullName,
          private: true,
          owner: { id: LEARNER.githubId },
          parent: { id: UPSTREAM.id },
        }),
      },
      "not-found",
    ],
    [
      "a fork of another repo",
      {
        [`/repos/${FORK.fullName}`]: json({
          id: FORK.id,
          full_name: FORK.fullName,
          private: false,
          owner: { id: LEARNER.githubId },
          parent: { id: 4242 },
          source: { id: 4242 },
        }),
      },
      "wrong-repo",
    ],
    ["a pinned SHA GitHub does not know in this repo", { [COMPARE]: json({}, 404) }, "not-found"],
  ];
  for (const [name, over, reason] of cases)
    test(`${name} -> ${reason}`, async () => {
      const { userId, ladderId } = await seed();
      const d = deps(over);
      expect(await verifyL2Branch(d.deps, userId, ladderId, URL_OK)).toEqual(rejected(reason));
      expect(await rows()).toEqual([]);
      expect(d.events).toEqual([]);
    });

  test("403 + x-ratelimit-remaining 0 mid-verification: 503 with retryAt; no row, no event", async () => {
    const { userId, ladderId } = await seed();
    const d = deps({}, (path) => (path.includes("/compare/") ? rateLimited(1_900_000_000) : undefined));
    expect(await verifyL2Branch(d.deps, userId, ladderId, URL_OK)).toEqual({
      status: 503,
      error: "rate-limited",
      retryAt: new Date(1_900_000_000_000).toISOString(),
    });
    expect(await rows()).toEqual([]);
    expect(d.events).toEqual([]);
  });

  test("a GitHub 500: 502 github-unavailable, nothing stored", async () => {
    const { userId, ladderId } = await seed();
    const d = deps({ [COMPARE]: json({}, 500) });
    expect(await verifyL2Branch(d.deps, userId, ladderId, URL_OK)).toEqual({
      status: 502,
      error: "github-unavailable",
    });
    expect(await rows()).toEqual([]);
  });

  test("a foreign host or http:// is rejected as invalid input before any fetch", async () => {
    const { userId, ladderId } = await seed();
    const d = deps();
    for (const url of [
      "https://github.com.evil.io/learner-a/proj/tree/main",
      "http://github.com/learner-a/proj/tree/main",
    ])
      expect(await verifyL2Branch(d.deps, userId, ladderId, url)).toEqual({ status: 400, error: "invalid-url" });
    expect(d.fx.calls).toEqual([]);
  });

  test("L2 still locked (L1 not passed), an unknown ladder or a bad id: 404 not-found before any fetch", async () => {
    const { userId, ladderId } = await seed();
    const d = deps();
    const locked = { ...d.deps, passedLevels: async () => ["L0"] };
    expect(await verifyL2Branch(locked, userId, ladderId, URL_OK)).toEqual({ status: 404, error: "not-found" });
    expect(await verifyL2Branch(d.deps, userId, "999999", URL_OK)).toEqual({ status: 404, error: "not-found" });
    expect(await verifyL2Branch(d.deps, userId, "x'1", URL_OK)).toEqual({ status: 404, error: "not-found" });
    expect(d.fx.calls).toEqual([]);
  });
});
