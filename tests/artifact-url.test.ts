// T013 Success Criterion 7 and edge cases: artifact links are parsed with new URL() and an exact github.com host.
import { describe, expect, test } from "bun:test";
import { parseBranchUrl, parseL4Url } from "../src/server/artifact-url.ts";

describe("T013 artifact URL parsing", () => {
  test("a branch link, also with a / in the branch name; the stored URL is rebuilt", () => {
    expect(parseBranchUrl("https://github.com/learner-a/proj/tree/feature/retry")).toEqual({
      owner: "learner-a",
      name: "proj",
      branch: "feature/retry",
      url: "https://github.com/learner-a/proj/tree/feature/retry",
    });
    expect(parseBranchUrl(" https://github.com/a/b/tree/main/?x=1#y ")?.url).toBe("https://github.com/a/b/tree/main");
    expect(parseBranchUrl("https://github.com/a/b/tree/f%C3%A9ature")?.branch).toBe("féature");
  });

  test("foreign hosts, other schemes, credentials, ports and non-branch paths are rejected before any fetch", () => {
    for (const bad of [
      "https://github.com.evil.io/a/b/tree/main",
      "https://evil.io/github.com/a/b/tree/main",
      "http://github.com/a/b/tree/main",
      "https://www.github.com/a/b/tree/main",
      "https://user:pw@github.com/a/b/tree/main",
      "https://github.com:8443/a/b/tree/main",
      "ftp://github.com/a/b/tree/main",
      "https://github.com/a/b",
      "https://github.com/a/b/tree/",
      "https://github.com/a/b/blob/main",
      "https://github.com/a/../tree/main",
      "https://github.com/a/b/tree/x..y",
      "https://github.com/a/b/tree/has%20space",
      "https://github.com/a/b/tree/%E0%A4%A",
      "https://github.com/a/b/tree/x%00",
      "a/b",
      `https://github.com/a/b/tree/${"x".repeat(2100)}`,
      42,
      undefined,
    ])
      expect(parseBranchUrl(bad)).toBeUndefined();
  });

  test("an L4 link is a repo or a pull request", () => {
    expect(parseL4Url("https://github.com/learner-a/mini-proj/")).toEqual({
      kind: "repo",
      owner: "learner-a",
      name: "mini-proj",
      url: "https://github.com/learner-a/mini-proj",
    });
    expect(parseL4Url("https://github.com/upstream-org/proj/pull/42")).toEqual({
      kind: "pr",
      owner: "upstream-org",
      name: "proj",
      number: 42,
      url: "https://github.com/upstream-org/proj/pull/42",
    });
    for (const bad of [
      "https://github.com.evil.io/a/b",
      "http://github.com/a/b/pull/1",
      "https://github.com/a/b/pull/0",
      "https://github.com/a/b/pull/1x",
      "https://github.com/a/b/issues/1",
      "https://github.com/a/b/tree/main",
      "https://github.com/a",
    ])
      expect(parseL4Url(bad)).toBeUndefined();
  });
});
