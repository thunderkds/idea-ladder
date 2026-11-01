import { mkdir, writeFile } from "node:fs/promises";
import { fixtureName, FIXTURE_DIR, type FixtureFile } from "./fixtures.js";
import { API, fetchRepoSnapshot, type RepoSnapshot } from "./github.js";

/** Keeps only the fields fetchRepoSnapshot reads, so fixtures stay small. */
function trimBody(url: string, text: string): string {
  if (!url.startsWith(API)) return text; // raw README / dependency file text
  const path = url.slice(API.length);
  if (path.includes("/commits/") || path.endsWith("/languages")) return text;
  const j = JSON.parse(text);
  if (path.includes("/git/trees/")) return JSON.stringify({ truncated: j.truncated === true, tree: j.tree.map((e: { path: string; type: string }) => ({ path: e.path, type: e.type })) });
  if (path.includes("/issues?")) return JSON.stringify(j.map((i: { number: number; pull_request?: unknown; labels: Array<{ name: string }> }) => ({ number: i.number, ...(i.pull_request ? { pull_request: {} } : {}), labels: i.labels.map((l) => ({ name: l.name })) })));
  return JSON.stringify({ default_branch: j.default_branch, topics: j.topics ?? [] });
}

export interface RecordOptions { fetchImpl?: typeof fetch; dir?: URL | string; sha?: string; token?: string; now?: () => Date }

/**
 * Reads one repo once and writes its fixture. All-or-nothing: if any call throws (rate limit, 404), no file is written.
 * Only the rate-limit headers are kept; the token is never stored.
 */
export async function recordRepo(fullName: string, opts: RecordOptions = {}): Promise<RepoSnapshot> {
  const real = opts.fetchImpl ?? fetch;
  const now = opts.now ?? (() => new Date());
  const fx: FixtureFile & { sha?: string } = { recordedAt: now().toISOString(), entries: {} };
  const recording = (async (url: string | URL | Request, init?: RequestInit) => {
    const res = await real(url, init);
    const text = await res.text();
    const body = res.ok ? trimBody(String(url), text) : text;
    fx.entries[String(url)] = {
      status: res.status,
      headers: Object.fromEntries(["x-ratelimit-remaining", "x-ratelimit-reset"].flatMap((h) => (res.headers.get(h) ? [[h, res.headers.get(h)!]] : []))),
      body,
    };
    return new Response(body, { status: res.status, headers: res.headers });
  }) as typeof fetch;
  const snap = await fetchRepoSnapshot(fullName, recording, { sha: opts.sha, token: opts.token });
  fx.sha = snap.sha;
  const dir = opts.dir ?? FIXTURE_DIR;
  const base = typeof dir === "string" ? new URL(`file://${dir.replace(/\/?$/, "/")}`) : dir;
  await mkdir(base, { recursive: true });
  await writeFile(new URL(fixtureName(fullName), base), JSON.stringify(fx, null, 1) + "\n");
  return snap;
}
