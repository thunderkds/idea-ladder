import { describe, expect, it } from "vitest";
import { confidenceScore } from "../src/confidence.js";
import type { RepoSnapshot } from "../src/github.js";

const base: RepoSnapshot = {
  sha: "a".repeat(40),
  defaultBranch: "main",
  readme: "x".repeat(1500),
  topics: [],
  languages: {},
  depFiles: ["package.json"],
  openIssues: 3,
  goodFirstIssues: 1,
};

describe("confidenceScore", () => {
  it("full marks -> 1.0, high, no fallback, no penalty reasons", () => {
    const c = confidenceScore(base);
    expect(c).toMatchObject({ score: 1, level: "high", fallbackToConcepts: false });
  });
  it("README < 1,500 chars -> -0.4 (1,499 penalised, 1,500 not)", () => {
    expect(confidenceScore({ ...base, readme: "x".repeat(1499) }).score).toBe(0.6);
    expect(confidenceScore({ ...base, readme: "x".repeat(1500) }).score).toBe(1);
  });
  it("0 open issues -> -0.3; 0 good first issue -> -0.1; no dep file -> -0.2", () => {
    expect(confidenceScore({ ...base, openIssues: 0, goodFirstIssues: 0 }).score).toBe(0.6);
    expect(confidenceScore({ ...base, goodFirstIssues: 0 }).score).toBe(0.9);
    expect(confidenceScore({ ...base, depFiles: [] }).score).toBe(0.8);
  });
  it("level cut points: 0.7 -> high, 0.69 region -> medium, < 0.4 -> low + fallback", () => {
    expect(confidenceScore({ ...base, openIssues: 0, goodFirstIssues: 1 }).level).toBe("high"); // 0.7
    expect(confidenceScore({ ...base, readme: "x".repeat(10), goodFirstIssues: 0 }).level).toBe("medium"); // 0.5
    const low = confidenceScore({ ...base, readme: "", openIssues: 0, goodFirstIssues: 0 }); // 0.2
    expect(low).toMatchObject({ level: "low", fallbackToConcepts: true });
    expect(confidenceScore({ ...base, readme: "x", openIssues: 0 }).score).toBe(0.3); // 1-.4-.3
  });
  it("exactly 0.4 is medium, not low", () => {
    // 1 - 0.4 - 0.2 = 0.4
    const c = confidenceScore({ ...base, readme: "x", depFiles: [] });
    expect(c.score).toBe(0.4);
    expect(c.level).toBe("medium");
    expect(c.fallbackToConcepts).toBe(false);
  });
  it("floors at 0 and lists a reason per penalty", () => {
    const c = confidenceScore({ ...base, readme: "", openIssues: 0, goodFirstIssues: 0, depFiles: [] });
    expect(c.score).toBe(0);
    expect(c.reasons).toHaveLength(4);
  });
});
