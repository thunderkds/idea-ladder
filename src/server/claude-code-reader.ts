// T006 AC 9: the repo reader on the claude-code back end. The same task as `pickCoreFiles`, run by headless
// `claude -p` on the owner's subscription with every built-in tool off and only the reader MCP server
// (src/server/reader-mcp.ts: list, read, search) loaded, in an empty temp directory. The answer goes through the
// same parse, tree check and one repair attempt as the API back end. No ANTHROPIC_API_KEY reaches the child.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { ReaderContext } from "./reader-mcp.ts";
import {
  type CallUsage,
  type CoreFile,
  CoreFilesSchema,
  MAX_PATH_CHARS,
  type PickResult,
  parseAnswer,
  ReaderInvalidOutputError,
  type ReaderLimits,
  SYSTEM,
  type TreeEntry,
  validate,
} from "./repo-reader.ts";

export const CLAUDE_CODE_MODEL = "claude-code";
export const CLAUDE_CODE_TIMEOUT_MS = 300_000;
const MCP_SCRIPT = join(import.meta.dir, "reader-mcp.ts");
const ALLOWED_TOOLS = ["mcp__reader__list", "mcp__reader__read", "mcp__reader__search"];
/** Asked of the CLI with --json-schema; the answer is still validated by CoreFilesSchema and the tree. */
const { $schema: _draft, ...answerSchema } = z.toJSONSchema(
  z.object({ coreFiles: z.array(CoreFilesSchema.shape.coreFiles.element) }),
);
// Without the "$schema" key: this CLI build rejects the draft 2020-12 URI z.toJSONSchema adds.
const ANSWER_SCHEMA = JSON.stringify(answerSchema);

/** The `claude -p` run failed (timeout, non-zero exit, is_error, unparsable output): the Inngest step may retry. */
export class ReaderFailedError extends Error {
  readonly code = "reader-failed";
  constructor(
    detail: string,
    readonly hitLimit: boolean,
  ) {
    super(`reader-failed: ${detail}`);
    this.name = "ReaderFailedError";
  }
}

export type PickCoreFilesClaudeCodeInput = {
  repo: string;
  sha: string;
  tree: TreeEntry[];
  treeTruncated?: boolean;
  /** `--model` alias or id; unset = the CLI default. */
  modelId?: string;
  limits: ReaderLimits;
  /** GitHub token for the MCP server's reads; optional (unauthenticated: 60 requests per hour). Never logged. */
  githubToken?: string;
  /** Called once per `claude -p` run with that run's total usage. */
  onUsage: (usage: CallUsage) => void;
  log?: (event: Record<string, unknown>) => void;
  claudeBin?: string;
  timeoutMs?: number;
};

type CliResult = {
  is_error?: boolean;
  subtype?: string;
  result?: string;
  structured_output?: unknown;
  session_id?: string;
  num_turns?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  modelUsage?: Record<string, unknown>;
};

/** Runs the reader through `claude -p` and returns 3-10 validated core files, or throws a typed error. */
export async function pickCoreFilesClaudeCode(input: PickCoreFilesClaudeCodeInput): Promise<PickResult> {
  const log = input.log ?? ((e) => console.warn(JSON.stringify(e)));
  const blobs = new Set(
    input.tree.filter((t) => t.type === "blob" && t.path.length <= MAX_PATH_CHARS).map((t) => t.path),
  );
  // An empty temp cwd: no project CLAUDE.md, hooks or settings load. Removed afterwards, also on error.
  const dir = await mkdtemp(join(tmpdir(), "il-reader-"));
  try {
    const context: ReaderContext = {
      fullName: input.repo,
      sha: input.sha,
      tree: input.tree,
      ...(input.treeTruncated ? { treeTruncated: true } : {}),
    };
    const contextFile = join(dir, "context.json");
    const callsFile = join(dir, "calls");
    const mcpConfig = join(dir, "mcp.json");
    await writeFile(contextFile, JSON.stringify(context), { mode: 0o600 });
    await writeFile(
      mcpConfig,
      JSON.stringify({
        mcpServers: {
          reader: {
            type: "stdio",
            command: process.execPath,
            args: [MCP_SCRIPT],
            env: {
              READER_CONTEXT_FILE: contextFile,
              READER_MAX_STEPS: String(input.limits.maxSteps),
              READER_CALLS_FILE: callsFile,
              ...(input.githubToken ? { GITHUB_TOKEN: input.githubToken } : {}),
            },
          },
        },
      }),
      { mode: 0o600 },
    );

    let totalTokens = 0;
    let modelCalls = 0;
    const toolCalls = async () => Number((await readFile(callsFile, "utf8").catch(() => "0")) || 0);
    const hitLimit = async () => (await toolCalls()) > input.limits.maxSteps || totalTokens > input.limits.tokenBudget;

    const run = async (prompt: string, resume?: string) => {
      const out = await runClaude(input, dir, mcpConfig, prompt, resume).catch(async (err: unknown) => {
        throw new ReaderFailedError(err instanceof Error ? err.message : String(err), await hitLimit());
      });
      const u = out.usage ?? {};
      const cached = (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      const usage: CallUsage = {
        model: input.modelId ?? Object.keys(out.modelUsage ?? {})[0] ?? CLAUDE_CODE_MODEL,
        inputTokens: u.input_tokens ?? 0,
        outputTokens: u.output_tokens ?? 0,
        cachedInputTokens: cached,
      };
      modelCalls += out.num_turns ?? 1;
      totalTokens += usage.inputTokens + usage.cachedInputTokens + usage.outputTokens;
      input.onUsage(usage);
      if (out.is_error) throw new ReaderFailedError(`claude reported an error (${out.subtype})`, await hitLimit());
      const text = out.structured_output !== undefined ? JSON.stringify(out.structured_output) : (out.result ?? "");
      return { answer: parseAnswer(text), sessionId: out.session_id };
    };

    const first = await run(
      `${SYSTEM}\n\nYour tools are mcp__reader__list, mcp__reader__read and mcp__reader__search.\n\nRepository ${input.repo} at commit ${input.sha} (${blobs.size} files). Find its core files. Start with list("").`,
    );
    let answer = first.answer;
    let { kept, dropped } = validate(answer.files, blobs);
    if (kept.length < 3) {
      const problems = [
        answer.problem,
        dropped.length ? `these paths are not files in the tree: ${dropped.join(", ")}` : undefined,
        `only ${kept.length} valid paths, at least 3 needed`,
      ]
        .filter(Boolean)
        .join("; ");
      ({ answer } = await run(
        `Your answer was not usable: ${problems}. Reply again with the JSON answer only, using exact paths from the tree.`,
        first.sessionId,
      ));
      const second = validate(answer.files, blobs);
      kept = second.kept;
      dropped = [...dropped, ...second.dropped];
    }
    if (dropped.length) log({ event: "reader-dropped-paths", repo: input.repo, sha: input.sha, dropped });
    const limited = await hitLimit();
    const final = CoreFilesSchema.safeParse({ coreFiles: kept });
    if (!final.success)
      throw new ReaderInvalidOutputError(`${kept.length} valid paths after one repair attempt`, limited);
    return {
      coreFiles: final.data.coreFiles as CoreFile[],
      modelCalls,
      toolCalls: await toolCalls(),
      hitLimit: limited,
      totalTokens,
      dropped,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** One `claude -p` run; resolves the parsed JSON result, rejects on timeout, non-zero exit or unparsable output. */
async function runClaude(
  input: PickCoreFilesClaudeCodeInput,
  cwd: string,
  mcpConfig: string,
  prompt: string,
  resume?: string,
): Promise<CliResult> {
  const argv = [
    input.claudeBin ?? "claude",
    "-p",
    prompt,
    "--output-format",
    "json",
    "--json-schema",
    ANSWER_SCHEMA,
    "--tools",
    "",
    "--mcp-config",
    mcpConfig,
    "--strict-mcp-config",
    "--setting-sources",
    "",
    "--disable-slash-commands",
    ...(input.modelId ? ["--model", input.modelId] : []),
    ...(resume ? ["--resume", resume] : []),
    "--allowedTools",
    ...ALLOWED_TOOLS,
  ];
  // The subscription back end: an API key in the parent environment must never reach the child.
  const { ANTHROPIC_API_KEY: _key, ...env } = process.env;
  const proc = Bun.spawn(argv, { cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGKILL");
  }, input.timeoutMs ?? CLAUDE_CODE_TIMEOUT_MS);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (timedOut) throw new Error(`claude timed out after ${input.timeoutMs ?? CLAUDE_CODE_TIMEOUT_MS} ms`);
    let parsed: CliResult | undefined;
    try {
      parsed = JSON.parse(stdout) as CliResult;
    } catch {
      parsed = undefined;
    }
    if (code !== 0 && !parsed?.is_error)
      throw new Error(`claude exited with code ${code}: ${stderr.trim().slice(0, 300)}`);
    if (!parsed || typeof parsed !== "object") throw new Error("claude printed no JSON result");
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}
