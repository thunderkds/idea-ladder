// T006 claude-code back end: the reader's three tools (list, read, search) as a stdio MCP server for `claude -p`.
// Hand-written newline-delimited JSON-RPC 2.0 (no MCP SDK dependency). The tools are the SAME `createReaderTools`
// as the API back end, so path checks, read bounds and injection hygiene are identical. The step cap lives here:
// this Claude Code build has no --max-turns, so after READER_MAX_STEPS tool calls every call is refused.
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { z } from "zod";
import { githubRepoClient } from "./github-repo.ts";
import { createReaderTools, type ReadFile, type TreeEntry } from "./repo-reader.ts";

export const STEP_LIMIT_MESSAGE = "error: step limit reached: give your final answer now, using what you have seen";
/** Refused calls after the cap before the server exits (the model ignored the step-limit error). */
export const CALLS_AFTER_CAP = 3;
export const EXIT_AFTER_CAP = 3;

/** The JSON file named by READER_CONTEXT_FILE. `files` (fixture mode, null = binary) replaces live GitHub reads. */
export type ReaderContext = {
  fullName: string;
  sha: string;
  tree: TreeEntry[];
  treeTruncated?: boolean;
  files?: Record<string, string | null>;
};

type Request = { jsonrpc?: string; id?: string | number | null; method?: unknown; params?: Record<string, unknown> };
type Response = { jsonrpc: "2.0"; id: string | number | null } & (
  | { result: unknown }
  | { error: { code: number; message: string } }
);

/** One handler per server process: answers one JSON-RPC message, or null for a notification. */
export function createReaderMcp(
  ctx: ReaderContext,
  readFile: ReadFile,
  maxSteps: number,
  onCall: (calls: number) => void = () => {},
) {
  const tools = createReaderTools(ctx.tree, readFile, { treeTruncated: ctx.treeTruncated });
  const names = Object.keys(tools) as (keyof typeof tools)[];
  let calls = 0;
  const text = (t: string, isError: boolean) => ({ content: [{ type: "text", text: t }], isError });

  async function callTool(params: Record<string, unknown>) {
    calls++;
    onCall(calls);
    if (calls > maxSteps) return text(STEP_LIMIT_MESSAGE, true);
    const name = params.name as keyof typeof tools;
    if (!names.includes(name)) return text(`error: unknown tool ${JSON.stringify(String(params.name))}`, true);
    const t = tools[name];
    const args = (t.inputSchema as unknown as z.ZodType).safeParse(params.arguments ?? {});
    if (!args.success) return text(`error: invalid arguments: ${args.error.issues[0]?.message}`, true);
    try {
      const out = (await (t.execute as (i: unknown, o: unknown) => Promise<string>)(args.data, {
        toolCallId: `mcp-${calls}`,
        messages: [],
      })) as string;
      return text(out, out.startsWith("error: "));
    } catch (err) {
      // A GitHub transport error: the model sees a tool error, the operator sees the cause on stderr.
      console.error(JSON.stringify({ event: "reader-mcp-read-failed", repo: ctx.fullName, error: String(err) }));
      return text("error: read-failed (GitHub error; try another file)", true);
    }
  }

  async function handle(msg: Request): Promise<Response | null> {
    const id = msg.id ?? null;
    const ok = (result: unknown): Response => ({ jsonrpc: "2.0", id, result });
    if (msg.id === undefined) return null; // notifications (notifications/initialized, cancelled): no reply
    switch (msg.method) {
      case "initialize":
        return ok({
          protocolVersion: typeof msg.params?.protocolVersion === "string" ? msg.params.protocolVersion : "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "reader", version: "1.0.0" },
        });
      case "ping":
        return ok({});
      case "tools/list":
        return ok({
          tools: names.map((n) => ({
            name: n,
            description: tools[n].description,
            inputSchema: z.toJSONSchema(tools[n].inputSchema as unknown as z.ZodType),
          })),
        });
      case "tools/call":
        return ok(await callTool(msg.params ?? {}));
      default:
        return { jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${String(msg.method)}` } };
    }
  }

  /** True once the model made CALLS_AFTER_CAP calls past the cap: the server should exit. */
  const exhausted = () => calls >= maxSteps + CALLS_AFTER_CAP;
  return { handle, exhausted };
}

if (import.meta.main) {
  const env = process.env;
  const ctx = JSON.parse(readFileSync(env.READER_CONTEXT_FILE as string, "utf8")) as ReaderContext;
  const maxSteps = Number(env.READER_MAX_STEPS);
  if (!Number.isInteger(maxSteps) || maxSteps < 1) {
    console.error("reader-mcp: READER_MAX_STEPS must be a positive integer");
    process.exit(2);
  }
  const files = ctx.files;
  // Live mode: GitHub at the pinned SHA; GITHUB_TOKEN is optional (unauthenticated reads: 60 requests per hour).
  const github = files
    ? undefined
    : githubRepoClient({ baseUrl: "https://api.github.com", token: env.GITHUB_TOKEN ?? "" });
  const readFile: ReadFile = files
    ? async (path) => (Object.hasOwn(files, path) ? (files[path] ?? null) : "")
    : (path) => (github as ReturnType<typeof githubRepoClient>).readFile(ctx.fullName, ctx.sha, path);
  // READER_CALLS_FILE: the tool-call count, for the parent reader (steps used, cap hit).
  const callsFile = env.READER_CALLS_FILE;
  const server = createReaderMcp(ctx, readFile, maxSteps, (n) => callsFile && writeFileSync(callsFile, String(n)));
  const send = (r: Response, then?: () => void) => process.stdout.write(`${JSON.stringify(r)}\n`, then);

  // Lines are answered in order: a tool call is counted against the cap in the order the client sent it.
  let queue = Promise.resolve();
  createInterface({ input: process.stdin }).on("line", (line) => {
    queue = queue.then(async () => {
      if (line.trim() === "") return;
      let msg: Request;
      try {
        msg = JSON.parse(line) as Request;
      } catch {
        send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
        return;
      }
      if (typeof msg !== "object" || msg === null || Array.isArray(msg)) {
        send({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "invalid request" } });
        return;
      }
      const res = await server.handle(msg);
      if (!res) return;
      if (server.exhausted()) send(res, () => process.exit(EXIT_AFTER_CAP));
      else send(res);
    });
  });
}
