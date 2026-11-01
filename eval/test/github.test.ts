import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fetchRepoSnapshot, RateLimitError, RepoNotFoundError } from "../src/github.js";
import { recordRepo } from "../src/record.js";

const SHA = "a".repeat(40);
type Route = (url: string) => { status?: number; body: unknown; headers?: Record<string, string> } | undefined;
const fakeFetch = (route: Route, calls: string[] = []) =>
  (async (url: string | URL | Request) => {
    const u = String(url); calls.push(u);
    const r = route(u);
    if (!r) return new Response("nf", { status: 404 });
    const body = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
    return new Response(body, { status: r.status ?? 200, headers: r.headers });
  }) as typeof fetch;

const okRoute = (truncated = false): Route => (u) => {
  if (u.endsWith("/repos/o/n")) return { body: { default_branch: "master", topics: ["x"] } };
  if (u.includes("/commits/master")) return { body: SHA };
  if (u.includes("/git/trees/")) return { body: { sha: "t", truncated, tree: [{ path: "README.md", type: "blob" }, { path: "src", type: "tree" }, { path: "src/a.js", type: "blob" }, { path: "package.json", type: "blob" }] } };
  if (u.includes(`/${SHA}/README.md`)) return { body: "# hi" };
  if (u.includes(`/${SHA}/package.json`)) return { body: '{"main":"src/a.js"}' };
  if (u.endsWith("/languages")) return { body: { JavaScript: 10 } };
  if (u.includes("/issues?")) return { body: [{ number: 1, labels: [{ name: "good first issue" }] }, { number: 2, pull_request: {}, labels: [{ name: "good first issue" }] }, { number: 3, labels: [] }] };
  return undefined;
};

describe("fetchRepoSnapshot", () => {
  it("resolves a non-main default branch to a 40-hex SHA and reads the tree", async () => {
    const s = await fetchRepoSnapshot("o/n", fakeFetch(okRoute()));
    expect(s.sha).toBe(SHA);
    expect(s.defaultBranch).toBe("master");
    expect(s.tree).toEqual(["README.md", "src/a.js", "package.json"]);
    expect(s.treeTruncated).toBe(false);
    expect(s.readme).toBe("# hi");
    expect(s.depFiles).toEqual(["package.json"]);
    expect(s.openIssues).toBe(2); // the pull request is excluded
    expect(s.goodFirstIssues).toBe(1);
  });
  it("records truncated:true instead of silently cutting", async () => {
    expect((await fetchRepoSnapshot("o/n", fakeFetch(okRoute(true)))).treeTruncated).toBe(true);
  });
  it("uses a pinned sha and skips the commit lookup", async () => {
    const calls: string[] = [];
    const s = await fetchRepoSnapshot("o/n", fakeFetch(okRoute(), calls), { sha: SHA });
    expect(s.sha).toBe(SHA);
    expect(calls.some((c) => c.includes("/commits/"))).toBe(false);
  });
  it("404 on the repo throws RepoNotFoundError", async () => {
    await expect(fetchRepoSnapshot("o/n", fakeFetch(() => undefined))).rejects.toBeInstanceOf(RepoNotFoundError);
  });
  it("exhausted rate limit throws RateLimitError", async () => {
    const f = fakeFetch(() => ({ status: 403, body: "x", headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1793507351" } }));
    await expect(fetchRepoSnapshot("o/n", f)).rejects.toBeInstanceOf(RateLimitError);
  });
  it("sends the token only as a header and never stores it", async () => {
    let auth = "";
    const inner = fakeFetch(okRoute());
    const f = (async (url: string | URL | Request, init?: RequestInit) => { auth ||= String((init?.headers as Record<string, string>)?.authorization ?? ""); return inner(url, init); }) as typeof fetch;
    const s = await fetchRepoSnapshot("o/n", f, { token: "SECRET" });
    expect(auth).toBe("Bearer SECRET");
    expect(JSON.stringify(s)).not.toContain("SECRET");
  });
});

describe("recordRepo (AC 3)", () => {
  it("writes a fixture that replays offline to the same snapshot", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fx-"));
    const live = await recordRepo("o/n", { fetchImpl: fakeFetch(okRoute()), dir });
    const { loadSnapshot } = await import("../src/fixtures.js");
    const replay = await loadSnapshot("o/n", dir);
    expect(replay).toEqual(live);
  });
  it("writes NO file when a call fails midway (no partial fixture)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fx-"));
    const f = fakeFetch((u) => (u.endsWith("/languages") ? { status: 403, body: "x", headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1793507351" } } : okRoute()(u)));
    await expect(recordRepo("o/n", { fetchImpl: f, dir })).rejects.toBeInstanceOf(RateLimitError);
    expect(await readdir(dir)).toEqual([]);
  });
  it("replay throws on a URL that was not recorded (tests never hit the network)", async () => {
    const { replayFetch } = await import("../src/fixtures.js");
    const { impl } = replayFetch({ recordedAt: "x", entries: {} });
    await expect(impl("https://api.github.com/x")).rejects.toThrow(/no fixture/);
  });
});
