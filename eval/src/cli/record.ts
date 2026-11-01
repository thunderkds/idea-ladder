// ci: skip — needs the network (and optionally GITHUB_TOKEN); every other script and test is offline.
// pnpm eval:record [--wait] [--only owner/name]   Reads each candidate once via the GitHub API at its pinned SHA.
// Needs the network; every other script and test runs offline. GITHUB_TOKEN from env if present (never stored).
// Repos that already have a fixture are skipped, so a rate-limited run can be repeated until all are recorded.
import { access, readFile } from "node:fs/promises";
import { z } from "zod";
import { FIXTURE_DIR, fixtureName } from "../fixtures.js";
import { API, RateLimitError, RepoNotFoundError } from "../github.js";
import { recordRepo } from "../record.js";
import { parseArgs } from "./args.js";

const candidates = z.array(z.object({ fullName: z.string(), sha: z.string().regex(/^[0-9a-f]{40}$/).optional() }).passthrough())
  .parse(JSON.parse(await readFile(new URL("../../golden/candidates.json", import.meta.url), "utf8")));
const { flags } = parseArgs(process.argv.slice(2));
const token = process.env.GITHUB_TOKEN || undefined;
const callsFor = (pinned: boolean) => (pinned ? 4 : 5); // repo, [commit], tree, languages, issues
const exists = (u: URL) => access(u).then(() => true, () => false);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function remaining(): Promise<{ left: number; reset: Date }> {
  const res = await fetch(`${API}/rate_limit`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  const j = (await res.json()) as { resources: { core: { remaining: number; reset: number } } };
  return { left: j.resources.core.remaining, reset: new Date(j.resources.core.reset * 1000) };
}

const todo = candidates.filter((c) => typeof flags.only !== "string" || c.fullName === flags.only);
const gone: string[] = [];
let written = 0;
for (const c of todo) {
  if (await exists(new URL(fixtureName(c.fullName), FIXTURE_DIR))) continue;
  for (;;) {
    try {
      const { left, reset } = await remaining();
      if (left < callsFor(!!c.sha)) throw new RateLimitError(reset);
      const snap = await recordRepo(c.fullName, { sha: c.sha, token });
      written++;
      console.log(`${c.fullName}: ${snap.sha} tree=${snap.tree.length}${snap.treeTruncated ? " TRUNCATED" : ""} (~${left - callsFor(!!c.sha)} API calls left)`);
      break;
    } catch (e) {
      if (e instanceof RepoNotFoundError) { gone.push(c.fullName); console.error(`${c.fullName}: NOT FOUND (renamed or deleted); continuing`); break; }
      if (e instanceof RateLimitError) {
        console.error(`${new Date().toISOString()} rate limit: resets ${e.resetAt.toISOString()}; ${written} fixtures written this run`);
        if (!flags.wait) { process.exitCode = 2; todo.length = 0; break; }
        await sleep(Math.max(0, e.resetAt.getTime() - Date.now()) + 5000);
        continue;
      }
      throw e;
    }
  }
  if (todo.length === 0) break;
}
if (gone.length) { console.error(`not found: ${gone.join(", ")}`); process.exitCode = 1; }
console.log(`done: ${written} written`);
