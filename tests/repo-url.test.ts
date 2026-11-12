import { describe, expect, test } from "bun:test";
import { parseRepoUrl, UnsupportedUrlError } from "../src/server/repo-url.ts";

describe("parseRepoUrl (AC 1)", () => {
  const accepted: [input: string, owner: string, name: string][] = [
    ["https://github.com/developit/mitt", "developit", "mitt"],
    ["http://github.com/developit/mitt", "developit", "mitt"],
    ["https://www.github.com/developit/mitt", "developit", "mitt"],
    ["https://github.com/developit/mitt/", "developit", "mitt"],
    ["https://github.com/developit/mitt.git", "developit", "mitt"],
    ["https://github.com/lukeed/dset/tree/master/src/index.js", "lukeed", "dset"],
    ["https://github.com/lukeed/dset/tree/master", "lukeed", "dset"],
    ["The-Pocket/PocketFlow", "The-Pocket", "PocketFlow"],
    ["  https://GitHub.com/Developit/Mitt?tab=readme-ov-file#readme  ", "Developit", "Mitt"],
    ["kjd/idna.py", "kjd", "idna.py"],
  ];
  for (const [input, owner, name] of accepted) {
    test(`accepts ${JSON.stringify(input)}`, () => {
      expect(parseRepoUrl(input)).toEqual({ owner, name });
    });
  }

  const rejected = [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "https://gitlab.com/o/n",
    "https://github.com/o",
    "https://github.com/o/n/issues",
    "https://github.com.evil.example/o/n",
    "https://user:pass@github.com/o/n",
    "o/..",
    "ftp://github.com/o/n",
    "https://github.com:8443/o/n",
    "https://github.com/o_bad/n",
    `https://github.com/${"a".repeat(40)}/n`,
    "",
  ];
  for (const input of rejected) {
    test(`rejects ${JSON.stringify(input)} with UnsupportedUrlError`, () => {
      expect(() => parseRepoUrl(input)).toThrow(UnsupportedUrlError);
    });
  }

  test("makes no network call", () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      throw new Error("no network");
    }) as unknown as typeof fetch;
    try {
      for (const input of rejected) expect(() => parseRepoUrl(input)).toThrow(UnsupportedUrlError);
      for (const [input] of accepted) parseRepoUrl(input);
    } finally {
      globalThis.fetch = original;
    }
    expect(calls).toBe(0);
  });
});
