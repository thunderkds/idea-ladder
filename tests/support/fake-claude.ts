// A fake `claude` executable for the claude-code reader tests. Invoked as `bun fake-claude.ts <recordDir> ...argv`.
// Records argv, cwd, its full env and the mcp-config it was given to <recordDir>/calls.jsonl, then plays the next
// reply from <recordDir>/replies.json: { stdout, exit?, sleepMs?, toolCalls?, holdPipes? } (toolCalls is written to the
// READER_CALLS_FILE named in the mcp-config, as the MCP server would).
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Reply = { stdout: string; exit?: number; sleepMs?: number; toolCalls?: number; holdPipes?: boolean };
const [recordDir, ...argv] = process.argv.slice(2) as [string, ...string[]];
const callsPath = join(recordDir, "calls.jsonl");
const n = existsSync(callsPath) ? readFileSync(callsPath, "utf8").split("\n").filter(Boolean).length : 0;
const mcpPath = argv[argv.indexOf("--mcp-config") + 1] as string;
const mcp = JSON.parse(readFileSync(mcpPath, "utf8"));
appendFileSync(
  callsPath,
  `${JSON.stringify({
    argv,
    cwd: process.cwd(),
    env: process.env,
    mcp,
    context: JSON.parse(readFileSync(mcp.mcpServers.reader.env.READER_CONTEXT_FILE, "utf8")),
  })}\n`,
);
const replies = JSON.parse(readFileSync(join(recordDir, "replies.json"), "utf8")) as Reply[];
const reply = replies[Math.min(n, replies.length - 1)] as Reply;
if (reply.toolCalls !== undefined) writeFileSync(mcp.mcpServers.reader.env.READER_CALLS_FILE, String(reply.toolCalls));
// holdPipes: ignore SIGTERM and leave a grandchild holding stdout/stderr (as a stuck MCP server child would).
if (reply.holdPipes) {
  process.on("SIGTERM", () => {});
  Bun.spawn(["sleep", "30"], { stdin: "ignore", stdout: "inherit", stderr: "inherit" });
}
if (reply.sleepMs) await Bun.sleep(reply.sleepMs);
process.stdout.write(reply.stdout);
process.exit(reply.exit ?? 0);
