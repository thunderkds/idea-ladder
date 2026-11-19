// T013 AC 3, 4, 5 and Success Criteria 3, 4, 5: verifyL4Artifact (repo link or merged PR) writes the L4 evidence record.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { type ArtifactReason, verifyL4Artifact } from "../src/server/artifacts.ts";
import { type EvidenceRecord, evidencePassedLevels, hashRecord, writeEvidenceRecord } from "../src/server/evidence.ts";
import { githubRepoClient } from "../src/server/github-repo.ts";
import { VERIFIED_BY } from "../src/server/mcq-test.ts";
import { migrateUp } from "../src/server/migrate.ts";
import { levelLockState } from "../src/shared/levels.ts";
import { createTestDatabase } from "./support/db.ts";
import { type FixtureEntry, fixtureFetch, rateLimited } from "./support/github-fixtures.ts";
import {
  commit,
  FORK,
  json,
  LEARNER,
  MERGE,
  OTHER,
  OWN_HEAD,
  OWN_REPO,
  PINNED,
  t013Fixture,
  UPSTREAM,
} from "./support/t013-github.ts";

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

const NOW = new Date("2026-11-19T12:00:00Z");
const PR_URL = `https://github.com/${UPSTREAM.fullName}/pull/42`;
const REPO_URL = `https://github.com/${OWN_REPO.fullName}`;
const PULL = `/repos/${UPSTREAM.fullName}/pulls/42`;

/** The learner with L0-L3 passed (evidence records), and a ladder on the upstream repo at PINNED. */
async function seed() {
  const [u] = await db.sql`
    INSERT INTO users (github_id, github_login) VALUES (${LEARNER.githubId}, ${LEARNER.login}) RETURNING id::text AS id`;
  await db.sql`INSERT INTO repo_snapshots (repo_full_name, commit_sha, default_branch, archived, readme, topics, languages, dep_files, open_issues, good_first_issues, tree, tree_truncated)
    VALUES (${UPSTREAM.fullName}, ${PINNED}, 'main', false, 'r', '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, 0, 0, '[]'::jsonb, false)`;
  const [l] = await db.sql`
    INSERT INTO ladders (repo_full_name, commit_sha, status) VALUES (${UPSTREAM.fullName}, ${PINNED}, 'unverified') RETURNING id::text AS id`;
  await db.sql.begin(async (tx) => {
    for (const level of ["L0", "L1", "L2", "L3"])
      await writeEvidenceRecord(tx, u.id, l.id, {
        learner: "github:x",
        ladder: "repo:x",
        level,
        test: "mcq",
        evidence: {},
        verifiedBy: "test",
        verifiedAt: NOW.toISOString(),
      });
  });
  return { userId: u.id as string, ladderId: l.id as string };
}

function deps(over: Record<string, FixtureEntry> = {}, override?: Parameters<typeof fixtureFetch>[1]) {
  const fx = fixtureFetch([t013Fixture(over)], override);
  return {
    fx,
    deps: {
      sql: db.sql,
      github: githubRepoClient({ baseUrl: "https://api.github.com", token: "app-token", fetch: fx.impl }),
      passedLevels: evidencePassedLevels(db.sql),
      emit: async () => {
        throw new Error("L4 sends no event");
      },
      now: () => NOW,
    },
  };
}
const artifactRows = async () => await db.sql`SELECT level, kind, url, head_sha FROM artifacts ORDER BY id`;
const l4Records = async () =>
  (await db.sql`SELECT record FROM evidence_records WHERE level = 'L4'`).map(
    (r: { record: EvidenceRecord }) => r.record,
  );
const pull = (over: Record<string, unknown>) =>
  json({
    number: 42,
    state: "closed",
    merged: true,
    merge_commit_sha: MERGE,
    user: { id: LEARNER.githubId },
    base: { repo: { id: UPSTREAM.id } },
    ...over,
  });
const repoBody = (over: Record<string, unknown>) =>
  json({
    id: OWN_REPO.id,
    full_name: OWN_REPO.fullName,
    private: false,
    owner: { id: LEARNER.githubId },
    default_branch: "main",
    ...over,
  });

describe("T013 verifyL4Artifact: a pass writes the evidence record and completes the ladder (AC 3)", () => {
  test("merged PR in the upstream repo by the learner: evidence test artifact with merge_commit_sha; hash recomputes", async () => {
    const { userId, ladderId } = await seed();
    const result = await verifyL4Artifact(deps().deps, userId, ladderId, PR_URL);
    const expected: Omit<EvidenceRecord, "hash"> = {
      learner: `github:${LEARNER.login}`,
      ladder: `repo:${UPSTREAM.fullName}@${PINNED.slice(0, 7)}`,
      level: "L4",
      test: "artifact",
      evidence: { kind: "pr", url: PR_URL, repo: UPSTREAM.fullName, pr: 42, sha: MERGE },
      verifiedBy: VERIFIED_BY,
      verifiedAt: NOW.toISOString(),
    };
    expect(result).toMatchObject({
      artifact: { level: "L4", kind: "pr", url: PR_URL, headSha: MERGE },
      evidence: expected,
    });
    const [stored] = await l4Records();
    expect(stored).toMatchObject(expected);
    expect(stored?.hash).toBe(hashRecord(stored as EvidenceRecord));
    expect(await artifactRows()).toEqual([{ level: "L4", kind: "pr", url: PR_URL, head_sha: MERGE }]);
    expect(levelLockState(await evidencePassedLevels(db.sql)(ladderId, userId))).toEqual(Array(5).fill("passed"));
  });

  test("squash-merged PR: merged = true is the rule and its merge_commit_sha is recorded", async () => {
    const { userId, ladderId } = await seed();
    const squash = "a".repeat(40);
    const result = await verifyL4Artifact(
      deps({ [PULL]: pull({ merge_commit_sha: squash }) }).deps,
      userId,
      ladderId,
      PR_URL,
    );
    expect(result).toHaveProperty("evidence.evidence.sha", squash);
  });

  test("the learner's own repo: public, owner id = learner, a commit by the learner; default-branch head recorded", async () => {
    const { userId, ladderId } = await seed();
    const result = await verifyL4Artifact(deps().deps, userId, ladderId, REPO_URL);
    expect(result).toMatchObject({
      artifact: { kind: "repo", url: REPO_URL, repo: OWN_REPO.fullName, headSha: OWN_HEAD },
      evidence: { test: "artifact", evidence: { kind: "repo", url: REPO_URL, repo: OWN_REPO.fullName, sha: OWN_HEAD } },
    });
  });

  test("the same URL twice: one artifact row and one evidence record (the first)", async () => {
    const { userId, ladderId } = await seed();
    const a = await verifyL4Artifact(deps().deps, userId, ladderId, PR_URL);
    const later = { ...deps().deps, now: () => new Date("2026-11-20T00:00:00Z") };
    const b = await verifyL4Artifact(later, userId, ladderId, PR_URL);
    expect(b).toEqual(a);
    expect(await artifactRows()).toHaveLength(1);
    expect(await l4Records()).toHaveLength(1);
  });
});

describe("T013 verifyL4Artifact: rejections store nothing (AC 4, AC 5, Success Criteria 4, 5)", () => {
  const rejected = (reason: string) =>
    ({ status: 422, error: "artifact-rejected", reason: reason as ArtifactReason }) as const;
  const cases: [string, string, Record<string, FixtureEntry>, string][] = [
    ["an open PR", PR_URL, { [PULL]: pull({ state: "open", merged: false, merge_commit_sha: null }) }, "pr-not-merged"],
    ["a closed, unmerged PR", PR_URL, { [PULL]: pull({ merged: false }) }, "pr-not-merged"],
    ["a PR by another account", PR_URL, { [PULL]: pull({ user: { id: OTHER.githubId } }) }, "author-mismatch"],
    ["a PR into another repo", PR_URL, { [PULL]: pull({ base: { repo: { id: 4242 } } }) }, "wrong-repo"],
    ["a missing PR", PR_URL, { [PULL]: json({}, 404) }, "not-found"],
    [
      "a repo owned by another account",
      REPO_URL,
      { [`/repos/${OWN_REPO.fullName}`]: repoBody({ owner: { id: OTHER.githubId } }) },
      "author-mismatch",
    ],
    ["a private repo", REPO_URL, { [`/repos/${OWN_REPO.fullName}`]: repoBody({ private: true }) }, "not-found"],
    ["a missing repo", REPO_URL, { [`/repos/${OWN_REPO.fullName}`]: json({}, 404) }, "not-found"],
    [
      "a repo that is a fork of the ladder repo",
      REPO_URL,
      {
        [`/repos/${OWN_REPO.fullName}`]: repoBody({
          fork: true,
          parent: { id: UPSTREAM.id },
          source: { id: UPSTREAM.id },
        }),
      },
      "not-from-scratch",
    ],
    [
      "a repo with no commit by the learner",
      REPO_URL,
      {
        [`/repos/${OWN_REPO.fullName}/commits?sha=main&per_page=100`]: json([
          commit(OWN_HEAD, OTHER.githubId),
          commit("7".repeat(40), null),
        ]),
      },
      "author-mismatch",
    ],
    [
      "an empty repo",
      REPO_URL,
      { [`/repos/${OWN_REPO.fullName}/commits?sha=main&per_page=100`]: json({}, 409) },
      "no-new-commits",
    ],
  ];
  for (const [name, url, over, reason] of cases)
    test(`${name} -> ${reason}`, async () => {
      const { userId, ladderId } = await seed();
      expect(await verifyL4Artifact(deps(over).deps, userId, ladderId, url)).toEqual(rejected(reason));
      expect(await artifactRows()).toEqual([]);
      expect(await l4Records()).toEqual([]);
    });

  test("the ladder repo itself as a repo link -> not-from-scratch", async () => {
    const { userId, ladderId } = await seed();
    const url = `https://github.com/${UPSTREAM.fullName}`;
    const d = deps({ [`/repos/${UPSTREAM.fullName}`]: repoBody({ id: UPSTREAM.id, full_name: UPSTREAM.fullName }) });
    expect(await verifyL4Artifact(d.deps, userId, ladderId, url)).toEqual(rejected("not-from-scratch"));
  });

  test("a rate limit on the PR call: 503 with retryAt; no artifact row, no evidence record", async () => {
    const { userId, ladderId } = await seed();
    const d = deps({}, (path) => (path === PULL ? rateLimited(1_900_000_000) : undefined));
    expect(await verifyL4Artifact(d.deps, userId, ladderId, PR_URL)).toEqual({
      status: 503,
      error: "rate-limited",
      retryAt: new Date(1_900_000_000_000).toISOString(),
    });
    expect(await artifactRows()).toEqual([]);
    expect(await l4Records()).toEqual([]);
  });

  test("a branch link, a foreign host or a locked L4 is refused before any fetch", async () => {
    const { userId, ladderId } = await seed();
    const d = deps();
    expect(await verifyL4Artifact(d.deps, userId, ladderId, `https://github.com/${FORK.fullName}/tree/x`)).toEqual({
      status: 400,
      error: "invalid-url",
    });
    expect(await verifyL4Artifact(d.deps, userId, ladderId, "https://github.com.evil.io/a/b")).toEqual({
      status: 400,
      error: "invalid-url",
    });
    const locked = { ...d.deps, passedLevels: async () => ["L0", "L1", "L2"] };
    expect(await verifyL4Artifact(locked, userId, ladderId, PR_URL)).toEqual({ status: 404, error: "not-found" });
    expect(d.fx.calls).toEqual([]);
  });
});
