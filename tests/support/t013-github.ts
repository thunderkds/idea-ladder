// T013: GitHub REST responses for the artifact verifiers, in GitHub's response shape (fields trimmed to the ones read,
// plus enough context to read them). Hand-built from the REST docs, not live recordings: no public repo has a fork
// branch and PR by a test account. Served by fixtureFetch (tests/support/github-fixtures.ts); never the network.
import type { Fixture, FixtureEntry } from "./github-fixtures.ts";

export const UPSTREAM = { fullName: "upstream-org/proj", id: 1000 };
export const LEARNER = { githubId: 501, login: "learner-a" };
export const OTHER = { githubId: 777, login: "someone-else" };
export const FORK = { fullName: "learner-a/proj", id: 2000 };
export const OWN_REPO = { fullName: "learner-a/mini-proj", id: 3000 };
export const PINNED = "1".repeat(40);
export const HEAD = "2".repeat(40);
export const MERGE = "3".repeat(40);
export const OWN_HEAD = "4".repeat(40);
export const BRANCH = "feature/retry";

const H = { "content-type": "application/json; charset=utf-8", "x-ratelimit-remaining": "4990" };
export const json = (body: unknown, status = 200): FixtureEntry => ({ status, headers: H, body: JSON.stringify(body) });
const user = (id: number, login: string) => ({ id, login, type: "User" });
const repo = (r: { fullName: string; id: number }, ownerId: number, extra: Record<string, unknown> = {}) => ({
  id: r.id,
  full_name: r.fullName,
  private: false,
  fork: false,
  owner: user(ownerId, r.fullName.split("/")[0] as string),
  default_branch: "main",
  ...extra,
});
export const commit = (sha: string, authorId: number | null) => ({
  sha,
  commit: { author: { name: "Learner A", email: "learner@example.com" } }, // never used for identity
  author: authorId === null ? null : user(authorId, authorId === LEARNER.githubId ? LEARNER.login : OTHER.login),
});

/** The default world: a fork with a 2-commit branch by the learner, a merged PR upstream, the learner's own repo. */
export function t013Entries(): Record<string, FixtureEntry> {
  const upstream = repo(UPSTREAM, 9);
  return {
    [`/repos/${UPSTREAM.fullName}`]: json(upstream),
    [`/repos/${FORK.fullName}`]: json(repo(FORK, LEARNER.githubId, { fork: true, parent: upstream, source: upstream })),
    [`/repos/${FORK.fullName}/branches/feature/retry`]: json({ name: BRANCH, commit: { sha: HEAD } }),
    [`/repos/${FORK.fullName}/compare/${PINNED}...${HEAD}?per_page=100&page=1`]: json({
      status: "ahead",
      ahead_by: 2,
      behind_by: 0,
      total_commits: 2,
      commits: [commit("5".repeat(40), LEARNER.githubId), commit(HEAD, LEARNER.githubId)],
      files: [{ filename: "src/retry.ts", status: "added", additions: 20, deletions: 0 }],
    }),
    [`/repos/${UPSTREAM.fullName}/pulls/42`]: json({
      number: 42,
      state: "closed",
      merged: true,
      merge_commit_sha: MERGE,
      user: user(LEARNER.githubId, LEARNER.login),
      base: { ref: "main", repo: upstream },
    }),
    [`/repos/${OWN_REPO.fullName}`]: json(repo(OWN_REPO, LEARNER.githubId)),
    [`/repos/${OWN_REPO.fullName}/commits?sha=main&per_page=100`]: json([
      commit(OWN_HEAD, LEARNER.githubId),
      commit("6".repeat(40), LEARNER.githubId),
    ]),
  };
}

/** One fixture over `t013Entries()` with `over` replacing or adding entries. */
export function t013Fixture(over: Record<string, FixtureEntry> = {}): Fixture {
  return { fullName: "t013/none", sha: PINNED, recordedAt: "2026-11-19", entries: { ...t013Entries(), ...over } };
}
