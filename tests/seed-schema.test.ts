// T009 AC 5: the independent seed set eval/seed/blind-solver-seed.json: shape, provenance, kinds, hash lock.

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { checkAnswerKey } from "../src/server/answer-key-check.ts";
import { BLIND_CHUNK_CHARS } from "../src/server/blind-solver.ts";

type Item = {
  id: string;
  kind: "span" | "numeric" | "paraphrase";
  question: string;
  options: string[];
  key: string;
  chunk: string;
  source: { repo: string; path: string; sha: string };
};
const dir = new URL("../eval/seed/", import.meta.url);
const raw = await Bun.file(new URL("blind-solver-seed.json", dir)).text();
const seed = JSON.parse(raw) as Item[];
const V0 = ["The-Pocket/PocketFlow", "developit/mitt", "lukeed/dset"];
const fixture = async (repo: string) =>
  (await Bun.file(new URL(`../eval/golden/fixtures/${repo.replace("/", "__")}.json`, import.meta.url)).json()) as {
    readme: string;
    sha: string;
  };

describe("blind-solver seed set (AC 5)", () => {
  test("at least 40 MCQs from at least 4 repos, none of them a v0 repo", () => {
    expect(seed.length).toBeGreaterThanOrEqual(40);
    const repos = new Set(seed.map((m) => m.source.repo));
    expect(repos.size).toBeGreaterThanOrEqual(4);
    for (const r of repos) expect(V0).not.toContain(r);
  });

  test("4 different options, the key is one of them, unique ids, chunk fits the solver's cap", () => {
    expect(new Set(seed.map((m) => m.id)).size).toBe(seed.length);
    for (const m of seed) {
      expect(m.options, m.id).toHaveLength(4);
      expect(new Set(m.options).size, m.id).toBe(4);
      expect(m.options, m.id).toContain(m.key);
      expect(m.chunk.length, m.id).toBeLessThanOrEqual(BLIND_CHUNK_CHARS);
    }
  });

  test("every chunk is a verbatim quote of that repo's recorded README at the recorded sha", async () => {
    for (const m of seed) {
      const f = await fixture(m.source.repo);
      expect(f.readme.includes(m.chunk), m.id).toBe(true);
      expect(m.source.sha, m.id).toBe(f.sha);
    }
  });

  test("kinds are as labelled: span and numeric keys pass the code check, paraphrase keys do not", () => {
    for (const m of seed) {
      const passes = checkAnswerKey({ options: m.options, key: m.key, chunk: m.chunk }).pass;
      expect(passes, `${m.id} (${m.kind})`).toBe(m.kind !== "paraphrase");
    }
  });

  test("at least 8 items have a distractor that also appears in the chunk, and at least 8 are paraphrase keys", () => {
    const inChunk = seed.filter((m) =>
      m.options.some((o) => o !== m.key && checkAnswerKey({ options: m.options, key: o, chunk: m.chunk }).pass),
    );
    expect(inChunk.length).toBeGreaterThanOrEqual(8);
    expect(seed.filter((m) => m.kind === "paraphrase").length).toBeGreaterThanOrEqual(8);
  });

  test("the file matches its sha256 lock", async () => {
    const lock = (await Bun.file(new URL("blind-solver-seed.sha256", dir)).text()).trim().split(/\s+/)[0];
    expect(createHash("sha256").update(raw).digest("hex")).toBe(lock);
  });
});
