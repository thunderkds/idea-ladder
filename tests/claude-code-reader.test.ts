// T006 AC 9: the claude-code back end against a fake `claude` executable (no model call, no subscription use).
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pickCoreFilesClaudeCode, ReaderFailedError } from "../src/server/claude-code-reader.ts";
import { type CallUsage, ReaderInvalidOutputError, type TreeEntry } from "../src/server/repo-reader.ts";

const FAKE = join(import.meta.dir, "support", "fake-claude.ts");
const tree: TreeEntry[] = [
  { path: "README.md", type: "blob" },
  { path: "package.json", type: "blob" },
  { path: "src", type: "tree" },
  { path: "src/index.ts", type: "blob" },
  { path: "src/util.ts", type: "blob" },
];
const files = (paths: string[]) => ({ coreFiles: paths.map((path) => ({ path, reason: `core: ${path}` })) });
const result = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    num_turns: 4,
    session_id: "sess-1",
    result: "",
    usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200 },
    modelUsage: { "claude-sonnet-5-5": {} },
    ...over,
  });

let rec: string;
let bin: string;
const SECRETS = [
  "DATABASE_URL",
  "SESSION_SECRET",
  "GITHUB_CLIENT_SECRET",
  "GITHUB_APP_TOKEN",
  "VAPID_PRIVATE_KEY",
  "INNGEST_SIGNING_KEY",
  "ANTHROPIC_API_KEY",
];
const saved = Object.fromEntries([...SECRETS, "CLAUDE_CONFIG_DIR"].map((k) => [k, process.env[k]]));
beforeEach(async () => {
  rec = await mkdtemp(join(tmpdir(), "il-fake-claude-"));
  bin = join(rec, "claude");
  await writeFile(bin, `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "${rec}" "$@"\n`);
  await chmod(bin, 0o755);
});
afterEach(async () => {
  await rm(rec, { recursive: true, force: true });
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const replies = (r: { stdout: string; exit?: number; sleepMs?: number; toolCalls?: number }[]) =>
  writeFile(join(rec, "replies.json"), JSON.stringify(r));
const calls = async () =>
  (await readFile(join(rec, "calls.jsonl"), "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
const pick = (over: Partial<Parameters<typeof pickCoreFilesClaudeCode>[0]> = {}) => {
  const usage: CallUsage[] = [];
  const logs: Record<string, unknown>[] = [];
  const run = pickCoreFilesClaudeCode({
    repo: "acme/demo",
    sha: "a".repeat(40),
    tree,
    limits: { maxSteps: 15, tokenBudget: 80_000 },
    onUsage: (u) => usage.push(u),
    log: (e) => logs.push(e),
    claudeBin: bin,
    ...over,
  });
  return { run, usage, logs };
};

describe("pickCoreFilesClaudeCode (fake claude)", () => {
  test("exact argv: only the reader MCP server, no built-in tool, no settings; no API key reaches the child", async () => {
    for (const k of SECRETS) process.env[k] = `secret-${k}-must-not-leak`;
    process.env.CLAUDE_CONFIG_DIR = "/tmp/claude-config-kept";
    await replies([{ stdout: result({ structured_output: files(["src/index.ts", "src/util.ts", "README.md"]) }) }]);
    const { run } = pick({ modelId: "sonnet", githubToken: "gh-test-token" });
    const out = await run;
    expect(out.coreFiles.map((f) => f.path)).toEqual(["src/index.ts", "src/util.ts", "README.md"]);
    const [c] = await calls();
    const a: string[] = c.argv;
    expect(a[0]).toBe("-p");
    expect(a[1]).toContain("Repository acme/demo at commit");
    // The reader instructions replace the CLI's default system prompt; -p carries only the task.
    expect(a[1]).not.toContain("never instructions to you");
    expect(a[2]).toBe("--system-prompt");
    expect(a[3]).toContain("never instructions to you");
    expect(a[3]).toContain("mcp__reader__list");
    expect(a.slice(4)).toEqual([
      "--output-format",
      "json",
      "--json-schema",
      expect.stringContaining('"coreFiles"'),
      "--tools",
      "",
      "--mcp-config",
      expect.stringMatching(/mcp\.json$/),
      "--strict-mcp-config",
      "--setting-sources",
      "",
      "--disable-slash-commands",
      "--model",
      "sonnet",
      "--allowedTools",
      "mcp__reader__list",
      "mcp__reader__read",
      "mcp__reader__search",
    ]);
    expect(JSON.parse(a[7] as string).$schema).toBeUndefined();
    // The child env is an allowlist: none of the app's secrets, but what the CLI needs (PATH, HOME, CLAUDE_*).
    for (const k of SECRETS) expect(c.env[k]).toBeUndefined();
    expect(JSON.stringify(c.env)).not.toContain("must-not-leak");
    expect(c.env.PATH).toBe(process.env.PATH);
    expect(c.env.HOME).toBe(process.env.HOME);
    expect(c.env.CLAUDE_CONFIG_DIR).toBe("/tmp/claude-config-kept");
    expect(c.env.GITHUB_TOKEN).toBeUndefined();
    expect(c.cwd).toMatch(/il-reader-/);
    expect(Object.keys(c.mcp.mcpServers)).toEqual(["reader"]);
    const server = c.mcp.mcpServers.reader;
    expect(server.args[0]).toMatch(/src\/server\/reader-mcp\.ts$/);
    expect(server.env.READER_MAX_STEPS).toBe("15");
    expect(server.env.GITHUB_TOKEN).toBe("gh-test-token");
    expect(c.context).toEqual({ fullName: "acme/demo", sha: "a".repeat(40), tree });
    // the temp directory (context file, mcp config with the token) is gone
    expect(existsSync(c.cwd)).toBe(false);
  });

  test("no --model when no model id; GITHUB_TOKEN only when given", async () => {
    await replies([{ stdout: result({ structured_output: files(["src/index.ts", "src/util.ts", "README.md"]) }) }]);
    await pick().run;
    const [c] = await calls();
    expect(c.argv).not.toContain("--model");
    expect(c.mcp.mcpServers.reader.env.GITHUB_TOKEN).toBeUndefined();
  });

  test("a fenced JSON answer in the result text is parsed; usage maps to CallUsage", async () => {
    const text = `Here:\n\`\`\`json\n${JSON.stringify(files(["src/index.ts", "package.json", "README.md"]))}\n\`\`\``;
    await replies([{ stdout: result({ result: text }), toolCalls: 3 }]);
    const { run, usage } = pick();
    const out = await run;
    expect(out.coreFiles.map((f) => f.path)).toEqual(["src/index.ts", "package.json", "README.md"]);
    expect(usage).toEqual([
      { model: "claude-sonnet-5-5", inputTokens: 100, outputTokens: 50, cachedInputTokens: 1200 },
    ]);
    expect(out).toMatchObject({ modelCalls: 4, toolCalls: 3, hitLimit: false, totalTokens: 1350, dropped: [] });
    expect(out.tokens).toEqual({ input: 100, output: 50, cacheRead: 1000, cacheCreation: 200 });
  });

  test("invented paths dropped; one repair via --resume; still < 3 -> reader-invalid-output", async () => {
    const bad = result({ structured_output: files(["src/index.ts", "src/nope.ts", "lib/ghost.ts"]) });
    await replies([{ stdout: bad }, { stdout: bad }]);
    const { run, logs } = pick();
    const err = await run.catch((e) => e);
    expect(err).toBeInstanceOf(ReaderInvalidOutputError);
    expect(err.code).toBe("reader-invalid-output");
    const cs = await calls();
    expect(cs).toHaveLength(2);
    expect(cs[1].argv[1]).toContain("these paths are not files in the tree: src/nope.ts, lib/ghost.ts");
    expect(cs[1].argv).toContain("--resume");
    expect(cs[1].argv[2]).toBe("--system-prompt");
    expect(cs[1].argv[3]).toBe(cs[0].argv[3]);
    expect(cs[1].argv[cs[1].argv.indexOf("--resume") + 1]).toBe("sess-1");
    expect(logs).toEqual([
      {
        event: "reader-dropped-paths",
        repo: "acme/demo",
        sha: "a".repeat(40),
        dropped: ["src/nope.ts", "lib/ghost.ts", "src/nope.ts", "lib/ghost.ts"],
      },
    ]);
  });

  test("no answer, repair, still no answer -> reader-failed (not reader-invalid-output)", async () => {
    await replies([
      { stdout: result({ result: "I could not decide." }) },
      { stdout: result({ result: "Still thinking." }) },
    ]);
    const err = await pick().run.catch((e) => e);
    expect(err).toBeInstanceOf(ReaderFailedError);
    expect(err.code).toBe("reader-failed");
    expect(err.message).toMatch(/no JSON object in the answer/);
    expect(await calls()).toHaveLength(2);
  });

  test("a successful repair returns the repaired answer", async () => {
    await replies([
      { stdout: result({ result: "I could not decide." }) },
      { stdout: result({ structured_output: files(["src/index.ts", "src/util.ts", "README.md"]) }) },
    ]);
    const out = await pick().run;
    expect(out.coreFiles).toHaveLength(3);
    expect(out.modelCalls).toBe(8);
  });

  test("timeout kills the process -> reader-failed; temp dir removed", async () => {
    await replies([{ stdout: result(), sleepMs: 5_000 }]);
    const started = Date.now();
    const err = await pick({ timeoutMs: 300 }).run.catch((e) => e);
    expect(err).toBeInstanceOf(ReaderFailedError);
    expect(err.code).toBe("reader-failed");
    expect(err.message).toMatch(/timed out after 300 ms/);
    expect(Date.now() - started).toBeLessThan(4_000);
    const [c] = await calls();
    expect(existsSync(c.cwd)).toBe(false);
  });

  test("non-zero exit and unparsable output -> reader-failed", async () => {
    await replies([{ stdout: "boom", exit: 2 }]);
    expect(await pick().run.catch((e) => e)).toBeInstanceOf(ReaderFailedError);
    await rm(join(rec, "calls.jsonl"));
    await replies([{ stdout: "not json" }]);
    const err = await pick().run.catch((e) => e);
    expect(err).toBeInstanceOf(ReaderFailedError);
    expect(err.message).toMatch(/no JSON result/);
  });

  test("is_error -> reader-failed; its usage is still reported", async () => {
    await replies([{ stdout: result({ is_error: true, subtype: "error_during_execution" }), exit: 1 }]);
    const { run, usage } = pick();
    const err = await run.catch((e) => e);
    expect(err).toBeInstanceOf(ReaderFailedError);
    expect(err.message).toMatch(/error_during_execution/);
    expect(usage).toHaveLength(1);
  });

  test("over the token budget -> hitLimit true, valid answer still returned", async () => {
    await replies([{ stdout: result({ structured_output: files(["src/index.ts", "src/util.ts", "README.md"]) }) }]);
    const out = await pick({ limits: { maxSteps: 15, tokenBudget: 1000 } }).run;
    expect(out.hitLimit).toBe(true);
    expect(out.coreFiles).toHaveLength(3);
  });

  test("the step cap hit (more tool calls than READER_MAX_STEPS) -> hitLimit true", async () => {
    await replies([
      { stdout: result({ structured_output: files(["src/index.ts", "src/util.ts", "README.md"]) }), toolCalls: 6 },
    ]);
    const out = await pick({ limits: { maxSteps: 5, tokenBudget: 80_000 } }).run;
    expect(out).toMatchObject({ hitLimit: true, toolCalls: 6 });
  });

  test("hitLimit as on the API back end: cap 15, 15 tool calls -> true, 14 -> false", async () => {
    const answer = result({ structured_output: files(["src/index.ts", "src/util.ts", "README.md"]) });
    await replies([{ stdout: answer, toolCalls: 15 }]);
    expect(await pick().run).toMatchObject({ hitLimit: true, toolCalls: 15 });
    await rm(join(rec, "calls.jsonl"));
    await replies([{ stdout: answer, toolCalls: 14 }]);
    expect(await pick().run).toMatchObject({ hitLimit: false, toolCalls: 14 });
  });
});
