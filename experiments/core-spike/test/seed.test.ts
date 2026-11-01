import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REPOS, loadFixture } from "../src/fixture-fetch.js";
import type { Mcq } from "../src/measure.js";

const seed = JSON.parse(readFileSync(new URL("../fixtures/mcq-seed.json", import.meta.url), "utf8")) as Mcq[];

async function readmeAndSha(repo: string) {
  const fx = await loadFixture(repo);
  let readme = "", path = "", sha = "";
  for (const [u, e] of Object.entries(fx.entries)) {
    if (u.includes("/readme")) { const j = JSON.parse(e.body); readme = Buffer.from(j.content, "base64").toString("utf8"); path = j.path; }
    if (u.includes("/commits/")) sha = e.body.trim();
  }
  return { readme, path, sha };
}

describe("fixtures/mcq-seed.json (AC 2)", () => {
  it("has >= 40 MCQs, 4 options each, key among options, >= 120 derivable wrong keys, unique ids", () => {
    expect(seed.length).toBeGreaterThanOrEqual(40);
    for (const m of seed) {
      expect(m.options).toHaveLength(4);
      expect(new Set(m.options).size).toBe(4);
      expect(m.options).toContain(m.key);
    }
    expect(seed.reduce((n, m) => n + m.options.filter((o) => o !== m.key).length, 0)).toBeGreaterThanOrEqual(120);
    expect(new Set(seed.map((m) => m.id)).size).toBe(seed.length);
  });
  it("every chunk is a verbatim <= 300 char quote of the recorded README at the recorded sha", async () => {
    const src = new Map<string, Awaited<ReturnType<typeof readmeAndSha>>>();
    for (const r of REPOS) src.set(r, await readmeAndSha(r));
    for (const m of seed) {
      const s = src.get(m.source.repo)!;
      expect(m.chunk.length, m.id).toBeLessThanOrEqual(300);
      expect(s.readme.includes(m.chunk), m.id).toBe(true);
      expect(m.source.sha, m.id).toBe(s.sha);
      expect(m.source.path, m.id).toBe(s.path);
    }
  });
  it("covers all 3 repos and all 3 kinds", () => {
    expect(new Set(seed.map((m) => m.source.repo)).size).toBe(3);
    expect(new Set(seed.map((m) => m.kind))).toEqual(new Set(["span", "numeric", "paraphrase"]));
  });
});
