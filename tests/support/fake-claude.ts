// A fake `claude` executable for the claude-code reader tests. Invoked as `bun fake-claude.ts <recordDir> ...argv`.
// Records argv, cwd, its full env and the mcp-config it was given to <recordDir>/calls.jsonl, then plays the next
// reply from <recordDir>/replies.json: { stdout, exit?, sleepMs?, toolCalls?, holdPipes? } (toolCalls is written to the
// READER_CALLS_FILE named in the mcp-config, as the MCP server would; rateLimited lines are appended to
// READER_RATE_LIMITED_FILE, one per github-rate-limited tool error).
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Reply = {
  stdout: string;
  exit?: number;
  sleepMs?: number;
  toolCalls?: number;
  holdPipes?: boolean;
  rateLimited?: number;
};
const [recordDir, ...argv] = process.argv.slice(2) as [string, ...string[]];
const callsPath = join(recordDir, "calls.jsonl");
const n = existsSync(callsPath) ? readFileSync(callsPath, "utf8").split("\n").filter(Boolean).length : 0;
// No --mcp-config (model A's generate): record argv, cwd and env only.
const mcpIdx = argv.indexOf("--mcp-config");
const mcp = mcpIdx >= 0 ? JSON.parse(readFileSync(argv[mcpIdx + 1] as string, "utf8")) : undefined;
appendFileSync(
  callsPath,
  `${JSON.stringify({
    argv,
    cwd: process.cwd(),
    env: process.env,
    mcp,
    context: mcp ? JSON.parse(readFileSync(mcp.mcpServers.reader.env.READER_CONTEXT_FILE, "utf8")) : undefined,
  })}\n`,
);
const replies = JSON.parse(readFileSync(join(recordDir, "replies.json"), "utf8")) as Reply[];
const reply = replies[Math.min(n, replies.length - 1)] as Reply;
if (mcp && reply.toolCalls !== undefined)
  writeFileSync(mcp.mcpServers.reader.env.READER_CALLS_FILE, String(reply.toolCalls));
if (mcp && reply.rateLimited)
  appendFileSync(mcp.mcpServers.reader.env.READER_RATE_LIMITED_FILE, "1\n".repeat(reply.rateLimited));
// holdPipes: ignore SIGTERM and leave a grandchild holding stdout/stderr (as a stuck MCP server child would).
if (reply.holdPipes) {
  process.on("SIGTERM", () => {});
  Bun.spawn(["sleep", "30"], { stdin: "ignore", stdout: "inherit", stderr: "inherit" });
}
if (reply.sleepMs) await Bun.sleep(reply.sleepMs);
process.stdout.write(reply.stdout);
process.exit(reply.exit ?? 0);
