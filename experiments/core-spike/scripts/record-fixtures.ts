// Run once (unauthenticated GitHub API, 60 req/h): pnpm record-fixtures [owner/name ...]
// Records the exact responses fetchRepoSnapshot receives, trimmed to the fields it reads.
import { mkdir, writeFile } from "node:fs/promises";
import { fixturePath, REPOS, type FixtureFile } from "../src/fixture-fetch.js";
import { fetchRepoSnapshot } from "../src/github.js";

const trimBody = (url: string, text: string): string => {
  const path = url.replace("https://api.github.com", "");
  if (path.includes("/commits/") || path.includes("/languages")) return text;
  const j = JSON.parse(text);
  if (/\/readme\?/.test(path)) return JSON.stringify({ path: j.path, content: j.content });
  if (/\/contents\//.test(path)) return JSON.stringify(j.map((e: any) => ({ name: e.name, type: e.type })));
  if (/\/issues\?/.test(path)) return JSON.stringify(j.map((i: any) => ({ number: i.number, pull_request: i.pull_request ? {} : undefined, labels: i.labels.map((l: any) => ({ name: l.name })) })));
  return JSON.stringify({ default_branch: j.default_branch, topics: j.topics ?? [] });
};

const rl = await (await fetch("https://api.github.com/rate_limit")).json() as any;
console.log(`rate limit remaining: ${rl.resources.core.remaining}`);
const targets = process.argv.slice(2).length ? process.argv.slice(2) : [...REPOS];
if (rl.resources.core.remaining < targets.length * 7) throw new Error("not enough unauthenticated API budget left; stop and wait for reset");

for (const repo of targets) {
  const fx: FixtureFile = { recordedAt: new Date().toISOString(), entries: {} };
  const recording = (async (url: string | URL | Request, init?: RequestInit) => {
    const res = await fetch(url, init);
    const text = await res.text();
    const body = res.ok ? trimBody(String(url), text) : text;
    fx.entries[String(url)] = {
      status: res.status,
      headers: Object.fromEntries(["x-ratelimit-remaining", "x-ratelimit-reset"].flatMap((h) => (res.headers.get(h) ? [[h, res.headers.get(h)!]] : []))),
      body,
    };
    return new Response(body, { status: res.status, headers: res.headers });
  }) as typeof fetch;
  const snap = await fetchRepoSnapshot(repo, recording); // throws -> nothing written
  await mkdir(new URL("../fixtures/github/", import.meta.url), { recursive: true });
  await writeFile(fixturePath(repo), JSON.stringify(fx, null, 1) + "\n");
  console.log(`${repo}: ${snap.sha} (${Object.keys(fx.entries).length} calls)`);
}
