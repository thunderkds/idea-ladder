import { describe, expect, test } from "bun:test";
import { FixtureSchema } from "../src/schema.ts";
import { GitHubError, RateLimitError, RepoNotFoundError, recordRepo, resolveHeadSha } from "../src/github.ts";

const SHA = "a".repeat(40);
const TOKEN = "ghp_TESTTOKEN0123456789abcdefghijklmnop";

interface StubOpts {
  defaultBranch?: string;
  truncated?: boolean;
  repoStatus?: number;
  rateLimitOn?: string;
  commitStatus?: number;
}

/** A fake GitHub API. Records every request; never touches the network. */
function stub(o: StubOpts = {}) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    if (o.rateLimitOn && url.includes(o.rateLimitOn)) {
      return new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1893456000" } });
    }
    if (url.endsWith("/repos/o/r")) {
      if (o.repoStatus === 404) return json({ message: "Not Found" }, 404);
      return json({ default_branch: o.defaultBranch ?? "main", topics: ["t1"], stargazers_count: 1234, language: "TypeScript", archived: false });
    }
    if (url.includes(`/commits/${SHA}`)) return o.commitStatus ? json({}, o.commitStatus) : new Response(SHA, { status: 200 });
    if (url.includes("/commits/")) return new Response(SHA, { status: 200 });
    if (url.includes("/readme")) return json({ content: Buffer.from("# Hello\nsee src/index.ts").toString("base64") });
    if (url.endsWith("/languages")) return json({ TypeScript: 100 });
    if (url.includes("/git/trees/")) {
      return json({
        sha: SHA,
        truncated: o.truncated ?? false,
        tree: [
          { path: "package.json", type: "blob", size: 40 },
          { path: "src", type: "tree" },
          { path: "src/index.ts", type: "blob", size: 10 },
          { path: "src/package.json", type: "blob", size: 10 },
        ],
      });
    }
    if (url.includes("/contents/package.json")) return json({ content: Buffer.from('{"main":"src/index.ts"}').toString("base64"), size: 22 });
    if (url.includes("labels=")) return json([{ number: 2 }]);
    if (url.includes("/issues")) return json([{ number: 1 }, { number: 2 }, { number: 3, pull_request: {} }]);
    return json({}, 404);
  }) as typeof fetch;
  return { impl, calls };
}

describe("recordRepo (AC 3)", () => {
  test("records tree, README, topics, languages, dependency files, open issues, good-first-issue count at the pinned sha", async () => {
    const s = stub();
    const fx = await recordRepo({ fullName: "o/r", sha: SHA }, { fetch: s.impl, now: () => new Date("2026-11-12T00:00:00Z") });
    expect(FixtureSchema.parse(fx)).toEqual(fx);
    expect(fx).toMatchObject({
      fullName: "o/r",
      sha: SHA,
      defaultBranch: "main",
      stars: 1234,
      language: "TypeScript",
      topics: ["t1"],
      languages: { TypeScript: 100 },
      openIssues: 2, // the pull request is not counted
      goodFirstIssues: 1,
      treeTruncated: false,
      recordedAt: "2026-11-12T00:00:00.000Z",
    });
    expect(fx.readme).toContain("src/index.ts");
    expect(fx.tree.map((t) => t.path)).toContain("src/index.ts");
    expect(fx.depFiles).toEqual(["package.json"]); // root only: src/package.json is not a root dependency file
    expect(fx.depFileContents["package.json"]).toContain('"main"');
  });

  test("README, tree and file reads use the pinned sha, not the moving branch head", async () => {
    const s = stub();
    await recordRepo({ fullName: "o/r", sha: SHA }, { fetch: s.impl });
    const pinned = s.calls.filter((c) => c.url.includes("/readme") || c.url.includes("/git/trees/") || c.url.includes("/contents/"));
    expect(pinned.length).toBeGreaterThanOrEqual(3);
    for (const c of pinned) expect(c.url, c.url).toContain(SHA);
  });

  test("the token goes in the Authorization header and never into the fixture", async () => {
    const s = stub();
    const fx = await recordRepo({ fullName: "o/r", sha: SHA }, { fetch: s.impl, token: TOKEN });
    expect(JSON.stringify(fx)).not.toContain(TOKEN);
    expect(s.calls.every((c) => c.headers.authorization === `Bearer ${TOKEN}`)).toBe(true);
  });

  test("without a token no Authorization header is sent", async () => {
    const s = stub();
    await recordRepo({ fullName: "o/r", sha: SHA }, { fetch: s.impl });
    expect(s.calls.some((c) => "authorization" in c.headers)).toBe(false);
  });

  test("a truncated tree is detected and recorded, not silently cut", async () => {
    const fx = await recordRepo({ fullName: "o/r", sha: SHA }, { fetch: stub({ truncated: true }).impl });
    expect(fx.treeTruncated).toBe(true);
  });

  test("a non-main default branch is recorded", async () => {
    const fx = await recordRepo({ fullName: "o/r", sha: SHA }, { fetch: stub({ defaultBranch: "master" }).impl });
    expect(fx.defaultBranch).toBe("master");
  });

  test("deleted or renamed repo: RepoNotFoundError naming the repo", async () => {
    await expect(recordRepo({ fullName: "o/r", sha: SHA }, { fetch: stub({ repoStatus: 404 }).impl })).rejects.toThrow(RepoNotFoundError);
  });

  test("unknown sha: GitHubError, no fixture", async () => {
    await expect(recordRepo({ fullName: "o/r", sha: SHA }, { fetch: stub({ commitStatus: 422 }).impl })).rejects.toThrow(GitHubError);
  });

  test("rate limit mid-record: RateLimitError with the reset time, no partial fixture returned", async () => {
    let result: unknown = "unset";
    const p = recordRepo({ fullName: "o/r", sha: SHA }, { fetch: stub({ rateLimitOn: "/issues" }).impl }).then((r) => { result = r; });
    await expect(p).rejects.toThrow(RateLimitError);
    expect(result).toBe("unset");
    try { await p; } catch (e) { expect((e as RateLimitError).resetAt.toISOString()).toBe("2030-01-01T00:00:00.000Z"); }
  });

  test("a bad fullName is rejected before any request", async () => {
    const s = stub();
    await expect(recordRepo({ fullName: "../etc/passwd", sha: SHA }, { fetch: s.impl })).rejects.toThrow();
    expect(s.calls).toHaveLength(0);
  });
});

describe("resolveHeadSha", () => {
  test("resolves the default branch head (here: master) to a 40-hex sha", async () => {
    const s = stub({ defaultBranch: "master" });
    expect(await resolveHeadSha("o/r", { fetch: s.impl })).toBe(SHA);
    expect(s.calls.some((c) => c.url.includes("/commits/master"))).toBe(true);
  });
});
