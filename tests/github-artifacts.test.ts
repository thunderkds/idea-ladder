// T013 AC 5: the GitHub client calls the artifact verifiers use — app token only, rate limit, 404, pagination.
import { describe, expect, test } from "bun:test";
import { githubRepoClient, RateLimitError } from "../src/server/github-repo.ts";
import { fixtureFetch, rateLimited } from "./support/github-fixtures.ts";
import {
  BRANCH,
  commit,
  FORK,
  HEAD,
  json,
  LEARNER,
  MERGE,
  OWN_REPO,
  PINNED,
  t013Fixture,
  UPSTREAM,
} from "./support/t013-github.ts";

const client = (over: Parameters<typeof t013Fixture>[0] = {}, override?: Parameters<typeof fixtureFetch>[1]) => {
  const fx = fixtureFetch([t013Fixture(over)], override);
  return { gh: githubRepoClient({ baseUrl: "https://api.github.com", token: "app-token", fetch: fx.impl }), fx };
};

describe("T013 GitHub client: artifact calls (AC 5)", () => {
  test("repo facts with fork parent/source ids; 404 -> null", async () => {
    const { gh } = client();
    expect(await gh.getRepo(FORK.fullName)).toEqual({
      id: FORK.id,
      fullName: FORK.fullName,
      private: false,
      ownerId: LEARNER.githubId,
      defaultBranch: "main",
      parentId: UPSTREAM.id,
      sourceId: UPSTREAM.id,
    });
    expect((await gh.getRepo(OWN_REPO.fullName))?.parentId).toBeNull();
    expect(await gh.getRepo("nobody/missing")).toBeNull();
  });

  test("branch head (a / in the name stays a path), PR facts, commits; 409 empty repo -> []", async () => {
    const { gh, fx } = client({ [`/repos/${OWN_REPO.fullName}/commits?sha=empty&per_page=100`]: json({}, 409) });
    expect(await gh.getBranchHead(FORK.fullName, BRANCH)).toBe(HEAD);
    expect(fx.calls).toContain(`/repos/${FORK.fullName}/branches/feature/retry`);
    expect(await gh.getBranchHead(FORK.fullName, "gone")).toBeNull();
    expect(await gh.getPull(UPSTREAM.fullName, 42)).toEqual({
      merged: true,
      userId: LEARNER.githubId,
      mergeCommitSha: MERGE,
      baseRepoId: UPSTREAM.id,
    });
    expect(await gh.getPull(UPSTREAM.fullName, 43)).toBeNull();
    expect((await gh.listCommits(OWN_REPO.fullName, "main"))?.[0]?.authorId).toBe(LEARNER.githubId);
    expect(await gh.listCommits(OWN_REPO.fullName, "empty")).toEqual([]);
  });

  test("compare paginates 100 per page; above the maximum it stops after page 1", async () => {
    const page = (n: number, from: number, total: number) =>
      json({ total_commits: total, commits: Array.from({ length: n }, (_, i) => commit(HEAD, from + i)), files: [{}] });
    const base = `/repos/${FORK.fullName}/compare/${PINNED}...${HEAD}?per_page=100&page=`;
    const { gh, fx } = client({ [`${base}1`]: page(100, 1, 150), [`${base}2`]: page(50, 101, 150) });
    const range = await gh.compare(FORK.fullName, PINNED, HEAD, 250);
    expect(range?.totalCommits).toBe(150);
    expect(range?.authorIds).toEqual(Array.from({ length: 150 }, (_, i) => i + 1));
    expect(range?.files).toBe(1);
    expect(fx.calls.filter((c) => c.startsWith(base))).toHaveLength(2);

    const big = client({ [`${base}1`]: page(100, 1, 300) });
    expect(await big.gh.compare(FORK.fullName, PINNED, HEAD, 250)).toEqual({
      totalCommits: 300,
      files: 1,
      authorIds: [],
      tooLarge: true,
    });
    expect(big.fx.calls).toHaveLength(1);
    expect(await gh.compare(FORK.fullName, PINNED, "9".repeat(40), 250)).toBeNull();
  });

  test("403/429 with x-ratelimit-remaining 0 -> RateLimitError with the reset time; the app token is sent", async () => {
    for (const status of [403, 429]) {
      const { gh } = client({}, (path) => {
        if (!path.includes("/compare/")) return undefined;
        const r = rateLimited(1_900_000_000);
        return new Response(r.body, { status, headers: r.headers });
      });
      const err = await gh.compare(FORK.fullName, PINNED, HEAD, 250).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RateLimitError);
      expect((err as RateLimitError).resetAt.toISOString()).toBe(new Date(1_900_000_000_000).toISOString());
    }
    const auth: (string | null)[] = [];
    const gh = githubRepoClient({
      baseUrl: "https://api.github.com",
      token: "app-token",
      fetch: (async (_url: string, init?: RequestInit) => {
        auth.push(new Headers(init?.headers).get("authorization"));
        return Response.json({ message: "Not Found" }, { status: 404 });
      }) as unknown as typeof fetch,
    });
    await gh.getRepo(UPSTREAM.fullName);
    expect(auth).toEqual(["Bearer app-token"]);
  });
});
