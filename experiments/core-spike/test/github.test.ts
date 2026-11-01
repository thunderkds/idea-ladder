import { describe, expect, it } from "vitest";
import { RateLimitError, RepoNotFoundError, fetchRepoSnapshot } from "../src/github.js";

type Route = { status?: number; headers?: Record<string, string>; body?: string };

/** Offline fetch: matches by URL substring, first match wins. Records every URL requested. */
function mockFetch(routes: Array<[string, Route]>) {
  const calls: string[] = [];
  const impl = (async (url: string | URL | Request) => {
    const u = String(url);
    calls.push(u);
    const hit = routes.find(([frag]) => u.includes(frag));
    const r: Route = hit ? hit[1] : { status: 404, body: "{}" };
    return new Response(r.body ?? "", { status: r.status ?? 200, headers: r.headers ?? {} });
  }) as typeof fetch;
  return { impl, calls };
}

const SHA = "0123456789abcdef0123456789abcdef01234567";
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

const happy = (overrides: Array<[string, Route]> = []): Array<[string, Route]> => [
  ...overrides,
  ["/commits/", { body: SHA }],
  ["/readme", { body: JSON.stringify({ path: "README.md", content: b64("# Hi\nbody") }) }],
  ["/languages", { body: JSON.stringify({ TypeScript: 100 }) }],
  ["/contents/", { body: JSON.stringify([{ name: "package.json", type: "file" }, { name: "src", type: "dir" }]) }],
  ["labels=", { body: JSON.stringify([{ number: 1, labels: [{ name: "good first issue" }] }]) }],
  ["/issues", { body: JSON.stringify([{ number: 1, labels: [] }, { number: 2, labels: [], pull_request: {} }, { number: 3, labels: [] }]) }],
  ["/repos/o/r", { body: JSON.stringify({ default_branch: "master", topics: ["a", "b"] }) }],
];

describe("fetchRepoSnapshot", () => {
  it("returns the full snapshot, pins the sha, uses the default branch (master)", async () => {
    const { impl, calls } = mockFetch(happy());
    const s = await fetchRepoSnapshot("o/r", impl);
    expect(s).toEqual({
      sha: SHA,
      defaultBranch: "master",
      readme: "# Hi\nbody",
      topics: ["a", "b"],
      languages: { TypeScript: 100 },
      depFiles: ["package.json"],
      openIssues: 2, // pull requests are not issues
      goodFirstIssues: 1,
    });
    expect(calls.some((c) => c.includes("/commits/master"))).toBe(true);
    expect(calls.length).toBeLessThanOrEqual(20);
  });

  it("reads README, contents and issues at/after the pinned sha (readme + contents use ref=sha)", async () => {
    const { impl, calls } = mockFetch(happy());
    await fetchRepoSnapshot("o/r", impl);
    expect(calls.find((c) => c.includes("/readme"))).toContain(`ref=${SHA}`);
    expect(calls.find((c) => c.includes("/contents/"))).toContain(`ref=${SHA}`);
  });

  it("403 with x-ratelimit-remaining 0 -> RateLimitError carrying the reset time", async () => {
    const { impl } = mockFetch([
      ["/repos/o/r", { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1793500141" }, body: "{}" }],
    ]);
    const err = await fetchRepoSnapshot("o/r", impl).catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).resetAt.getTime()).toBe(1793500141 * 1000);
  });

  it("429 with remaining 0 -> RateLimitError", async () => {
    const { impl } = mockFetch([["/repos/o/r", { status: 429, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1" } }]]);
    await expect(fetchRepoSnapshot("o/r", impl)).rejects.toBeInstanceOf(RateLimitError);
  });

  it("rate limit hit midway throws and returns no partial snapshot", async () => {
    const { impl } = mockFetch(happy([["/languages", { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "5" } }]]));
    await expect(fetchRepoSnapshot("o/r", impl)).rejects.toBeInstanceOf(RateLimitError);
  });

  it("404 on the repo -> RepoNotFoundError", async () => {
    const { impl } = mockFetch([["/repos/o/r", { status: 404, body: "{}" }]]);
    await expect(fetchRepoSnapshot("o/r", impl)).rejects.toBeInstanceOf(RepoNotFoundError);
  });

  it("no README -> snapshot with readme '' (no throw)", async () => {
    const { impl } = mockFetch(happy([["/readme", { status: 404, body: "{}" }]]));
    const s = await fetchRepoSnapshot("o/r", impl);
    expect(s.readme).toBe("");
  });

  it("a plain 403 (no rate-limit header) is a generic error, not RateLimitError", async () => {
    const { impl } = mockFetch([["/repos/o/r", { status: 403, headers: { "x-ratelimit-remaining": "12" } }]]);
    const err = await fetchRepoSnapshot("o/r", impl).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(RateLimitError);
  });

  it("rejects a malformed repo name before any network call", async () => {
    const { impl, calls } = mockFetch([]);
    await expect(fetchRepoSnapshot("../etc/passwd", impl)).rejects.toThrow(/owner\/name/);
    expect(calls.length).toBe(0);
  });
});
