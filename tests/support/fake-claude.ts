// A fake `claude` executable for the claude-code reader tests. Invoked as `bun fake-claude.ts <recordDir> ...argv`.
// Records argv, cwd, selected env and the mcp-config it was given to <recordDir>/calls.jsonl, then plays the next
// reply from <recordDir>/replies.json: { stdout, exit?, sleepMs?, toolCalls? } (toolCalls is written to the
// READER_CALLS_FILE named in the mcp-config, as the MCP server would).
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Reply = { stdout: string; exit?: number; sleepMs?: number; toolCalls?: number };
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
    env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? null, FAKE_MARK: process.env.FAKE_MARK ?? null },
    mcp,
    context: JSON.parse(readFileSync(mcp.mcpServers.reader.env.READER_CONTEXT_FILE, "utf8")),
  })}\n`,
);
const replies = JSON.parse(readFileSync(join(recordDir, "replies.json"), "utf8")) as Reply[];
const reply = replies[Math.min(n, replies.length - 1)] as Reply;
if (reply.toolCalls !== undefined) writeFileSync(mcp.mcpServers.reader.env.READER_CALLS_FILE, String(reply.toolCalls));
if (reply.sleepMs) await Bun.sleep(reply.sleepMs);
process.stdout.write(reply.stdout);
process.exit(reply.exit ?? 0);
