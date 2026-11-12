// T006 fix batch: githubRepoClient.readFile treats any NUL as binary and downloads at most 1 MB.
import { describe, expect, test } from "bun:test";
import { githubRepoClient, MAX_FILE_BYTES } from "../src/server/github-repo.ts";

const SHA = "a".repeat(40);

/** A client whose contents API streams `chunks`; counts the chunks GitHub actually sent. */
function client(chunks: Uint8Array[]) {
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      const next = chunks[sent];
      if (!next) return c.close();
      sent++;
      c.enqueue(next);
    },
  });
  const fetch = (async () =>
    new Response(body, { headers: { "x-ratelimit-remaining": "4999" } })) as unknown as typeof globalThis.fetch;
  return { gh: githubRepoClient({ baseUrl: "https://api.github.com", token: "t", fetch }), sent: () => sent };
}
const text = (s: string) => new TextEncoder().encode(s);

describe("readFile (T006 fix batch)", () => {
  test("a NUL byte after byte 8,000 still makes the file binary (null)", async () => {
    const late = new Uint8Array(20_000).fill(97);
    late[15_000] = 0;
    expect(await client([late]).gh.readFile("acme/demo", SHA, "data.txt")).toBeNull();
  });

  test("plain text is returned whole", async () => {
    expect(await client([text("hello "), text("world")]).gh.readFile("acme/demo", SHA, "a.txt")).toBe("hello world");
  });

  test("a file over 1 MB: reading stops at 1 MB, the rest is never downloaded", async () => {
    const chunk = new Uint8Array(256 * 1024).fill(98);
    const c = client(Array.from({ length: 40 }, () => chunk)); // 10 MB offered
    const out = await c.gh.readFile("acme/demo", SHA, "big.txt");
    expect(out?.length).toBe(MAX_FILE_BYTES);
    expect(c.sent()).toBeLessThanOrEqual(6); // 4 chunks fill 1 MB; the stream may pull ahead slightly
  });
});
