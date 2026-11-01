import { describe, expect, it } from "vitest";
import { confidenceScore } from "../src/confidence.js";
import { REPOS, loadSnapshot } from "../src/fixture-fetch.js";

describe("recorded fixtures (offline)", () => {
  it("lukeed/dset: 40-hex sha, master branch, confidence object with reasons", async () => {
    const { snapshot } = await loadSnapshot("lukeed/dset");
    expect(snapshot.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(snapshot.defaultBranch).toBe("master");
    const c = confidenceScore(snapshot);
    expect(c.score).toBeGreaterThanOrEqual(0);
    expect(c.score).toBeLessThanOrEqual(1);
    expect(["low", "medium", "high"]).toContain(c.level);
    expect(c.reasons.length).toBeGreaterThan(0);
  });

  it("every v0 repo replays offline from fixtures with a 40-hex sha and a README", async () => {
    for (const repo of REPOS) {
      const { snapshot, calls } = await loadSnapshot(repo);
      expect(snapshot.sha).toMatch(/^[0-9a-f]{40}$/);
      expect(snapshot.readme.length).toBeGreaterThan(0);
      expect(calls).toBeLessThanOrEqual(20);
    }
  });
});
