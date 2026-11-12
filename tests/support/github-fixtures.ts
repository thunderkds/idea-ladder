// Recorded GitHub REST responses for the 3 v0 repos, replayed as an injectable fetch. Tests never hit the network.
// Re-record: `bun tests/support/github-fixtures.ts record` (unauthenticated: 18 calls of the 60/h limit).
import { githubRepoClient } from "../../src/server/github-repo.ts";

export const V0_REPOS = {
  "the-pocket/pocketflow": "f74d023f93607b8c3268133339a5e532a949898c",
  "developit/mitt": "6b41670516ed8e8b738612f60491995470aa63b3",
  "lukeed/dset": "05b1ec0f8cebe3b5d5667285bc7da90f38a7215e",
} as const;
export type V0Repo = keyof typeof V0_REPOS;

export type FixtureEntry = { status: number; headers: Record<string, string>; body: string };
export type Fixture = { fullName: string; sha: string; recordedAt: string; entries: Record<string, FixtureEntry> };

const fixturePath = (fullName: string) => `${import.meta.dir}/../fixtures/github/${fullName.replace("/", "__")}.json`;

export async function loadFixture(fullName: V0Repo): Promise<Fixture> {
  return (await Bun.file(fixturePath(fullName)).json()) as Fixture;
}

export type Override = (path: string) => Response | undefined;

/**
 * A fetch over recorded fixtures (keyed by path + query). `/commits?per_page=1` answers the fixture's pinned SHA.
 * `override` can replace any response (rate limit, 5xx). Unknown path -> 404, like GitHub; `calls` lists every path.
 */
export function fixtureFetch(fixtures: Fixture[], override?: Override) {
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const path = url.pathname + url.search;
    calls.push(path);
    const headers = new Headers(init?.headers);
    if (headers.get("user-agent") !== "idea-ladder") throw new Error("missing user-agent");
    const replaced = override?.(path);
    if (replaced) return replaced;
    for (const fx of fixtures) {
      if (path.toLowerCase() === `/repos/${fx.fullName}/commits?per_page=1`) {
        const html_url = `https://github.com/${fx.fullName}/commit/${fx.sha}`;
        return Response.json([{ sha: fx.sha, html_url }], { headers: { "x-ratelimit-remaining": "4999" } });
      }
      const entry = fx.entries[path];
      if (entry) return new Response(entry.body, { status: entry.status, headers: entry.headers });
    }
    return Response.json({ message: "Not Found" }, { status: 404, headers: { "x-ratelimit-remaining": "4999" } });
  }) as typeof fetch;
  return { impl, calls };
}

/** A 403 exactly as GitHub sends it when the primary rate limit is used up. */
export function rateLimited(resetEpochS: number): Response {
  return Response.json(
    { message: "API rate limit exceeded" },
    { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(resetEpochS) } },
  );
}

async function record() {
  const KEEP = ["content-type", "x-ratelimit-remaining", "x-ratelimit-reset"];
  for (const [fullName, sha] of Object.entries(V0_REPOS)) {
    const entries: Record<string, FixtureEntry> = {};
    const recording = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input);
      const res = await fetch(url, init);
      let body = await res.text();
      // The client reads only whether an issue is a PR; drop titles, bodies and user data from the fixture.
      if (res.ok && url.pathname.endsWith("/issues")) {
        const issues = JSON.parse(body) as { number: number; pull_request?: unknown }[];
        body = JSON.stringify(
          issues.map((i) => ({ number: i.number, ...(i.pull_request ? { pull_request: {} } : {}) })),
        );
      }
      const headers = Object.fromEntries(
        KEEP.flatMap((k) => (res.headers.get(k) ? [[k, res.headers.get(k) as string]] : [])),
      );
      entries[url.pathname + url.search] = { status: res.status, headers, body };
      return new Response(body, { status: res.status, headers });
    }) as typeof fetch;
    const client = githubRepoClient({ baseUrl: "https://api.github.com", token: "", fetch: recording });
    await client.fetchSnapshot(fullName, sha);
    const fixture: Fixture = { fullName, sha, recordedAt: new Date().toISOString(), entries };
    await Bun.write(fixturePath(fullName), `${JSON.stringify(fixture, null, 1)}\n`);
    console.log(`recorded ${fullName}@${sha}: ${Object.keys(entries).length} responses`);
  }
}

if (import.meta.main && process.argv[2] === "record") await record();
