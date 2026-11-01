import { readFile } from "node:fs/promises";
import { fetchRepoSnapshot, type RepoSnapshot } from "./github.js";

export const REPOS = ["The-Pocket/PocketFlow", "developit/mitt", "lukeed/dset"] as const;

export interface FixtureEntry { status: number; headers: Record<string, string>; body: string }
export interface FixtureFile { recordedAt: string; entries: Record<string, FixtureEntry> }

export const fixturePath = (fullName: string) =>
  new URL(`../fixtures/github/${fullName.replace("/", "__")}.json`, import.meta.url);

export async function loadFixture(fullName: string): Promise<FixtureFile> {
  return JSON.parse(await readFile(fixturePath(fullName), "utf8")) as FixtureFile;
}

/** A fetch that replays recorded responses and counts calls. Unknown URL -> throws (tests never hit the network). */
export function replayFetch(fx: FixtureFile) {
  const state = { calls: 0 };
  const impl = (async (url: string | URL | Request) => {
    state.calls++;
    const e = fx.entries[String(url)];
    if (!e) throw new Error(`no fixture for ${String(url)}`);
    return new Response(e.body, { status: e.status, headers: e.headers });
  }) as typeof fetch;
  return { impl, state };
}

export async function loadSnapshot(fullName: string): Promise<{ snapshot: RepoSnapshot; calls: number; recordedAt: string }> {
  const fx = await loadFixture(fullName);
  const { impl, state } = replayFetch(fx);
  const snapshot = await fetchRepoSnapshot(fullName, impl);
  return { snapshot, calls: state.calls, recordedAt: fx.recordedAt };
}
