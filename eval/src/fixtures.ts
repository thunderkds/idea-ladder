import { readFile } from "node:fs/promises";
import { fetchRepoSnapshot, type RepoSnapshot } from "./github.js";

export interface FixtureEntry { status: number; headers: Record<string, string>; body: string }
export interface FixtureFile { recordedAt: string; entries: Record<string, FixtureEntry> }

export const FIXTURE_DIR = new URL("../golden/fixtures/", import.meta.url);
export const fixtureName = (fullName: string) => `${fullName.replace("/", "__")}.json`;

export async function loadFixture(fullName: string, dir: URL | string = FIXTURE_DIR): Promise<FixtureFile> {
  const base = typeof dir === "string" ? new URL(`file://${dir.replace(/\/?$/, "/")}`) : dir;
  return JSON.parse(await readFile(new URL(fixtureName(fullName), base), "utf8")) as FixtureFile;
}

/** Replays recorded responses. An unrecorded URL throws, so tests can never reach the network. */
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

/** Rebuilds the snapshot from the recorded responses, with the SHA the fixture was pinned to. */
export async function loadSnapshot(fullName: string, dir: URL | string = FIXTURE_DIR): Promise<RepoSnapshot> {
  const fx = await loadFixture(fullName, dir);
  const sha = (fx as FixtureFile & { sha?: string }).sha;
  const { impl } = replayFetch(fx);
  return fetchRepoSnapshot(fullName, impl, sha ? { sha } : {});
}
