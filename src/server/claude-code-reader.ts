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
  type TokenCounts,
  type TreeEntry,
  validate,
} from "./repo-reader.ts";

export const CLAUDE_CODE_MODEL = "claude-code";
export const CLAUDE_CODE_TIMEOUT_MS = 300_000;
/** After the timeout kill, how long to wait for the pipes to close before giving up on them. */
const KILL_GRACE_MS = 2_000;
const MCP_SCRIPT = join(import.meta.dir, "reader-mcp.ts");
const ALLOWED_TOOLS = ["mcp__reader__list", "mcp__reader__read", "mcp__reader__search"];
/** Asked of the CLI with --json-schema; the answer is still validated by CoreFilesSchema and the tree. */
const { $schema: _draft, ...answerSchema } = z.toJSONSchema(
  z.object({ coreFiles: z.array(CoreFilesSchema.shape.coreFiles.element) }),
);
// Without the "$schema" key: this CLI build rejects the draft 2020-12 URI z.toJSONSchema adds.
const ANSWER_SCHEMA = JSON.stringify(answerSchema);
/** Replaces the CLI's default system prompt (as the API back end's `system` role); the same on the repair run. */
const SYSTEM_PROMPT = `${SYSTEM}\n\nYour tools are mcp__reader__list, mcp__reader__read and mcp__reader__search.`;

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

/** `claude` cannot be spawned (not installed / not on PATH): a retry cannot help, the step fails at once. */
export class ReaderNotInstalledError extends Error {
  readonly code = "reader-not-installed";
  constructor(bin: string) {
    super(`reader-not-installed: cannot run ${JSON.stringify(bin)} (is Claude Code installed and on PATH?)`);
    this.name = "ReaderNotInstalledError";
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
  /** GitHub API base for the MCP server's reads (config GITHUB_API_BASE_URL); unset = https://api.github.com. */
  githubApiBaseUrl?: string;
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
    const rateLimitedFile = join(dir, "rate-limited");
    const mcpConfig = join(dir, "mcp.json");
    await writeFile(contextFile, JSON.stringify(context), { mode: 0o600 });
    // READER_CALLS_START: the repair run's server continues the first run's count (one cap per invocation).
    const writeMcpConfig = (start: number) =>
      writeFile(
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
                READER_CALLS_START: String(start),
                READER_RATE_LIMITED_FILE: rateLimitedFile,
                ...(input.githubToken ? { GITHUB_TOKEN: input.githubToken } : {}),
                ...(input.githubApiBaseUrl ? { GITHUB_API_BASE_URL: input.githubApiBaseUrl } : {}),
              },
            },
          },
        }),
        { mode: 0o600 },
      );
    await writeMcpConfig(0);

    let totalTokens = 0;
    const tokens: TokenCounts = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
    let modelCalls = 0;
    const toolCalls = async () => Number((await readFile(callsFile, "utf8").catch(() => "0")) || 0);
    // One line per github-rate-limited tool error, appended by the MCP server (both runs share the file).
    const githubRateLimited = async () =>
      (await readFile(rateLimitedFile, "utf8").catch(() => "")).split("\n").filter(Boolean).length;
    const hitLimit = async () => (await toolCalls()) >= input.limits.maxSteps || totalTokens > input.limits.tokenBudget;

    const run = async (prompt: string, resume?: string) => {
      const out = await runClaude(input, dir, mcpConfig, prompt, resume).catch(async (err: unknown) => {
        if (err instanceof ReaderNotInstalledError) throw err;
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
      tokens.input += usage.inputTokens;
      tokens.output += usage.outputTokens;
      tokens.cacheRead += u.cache_read_input_tokens ?? 0;
      tokens.cacheCreation += u.cache_creation_input_tokens ?? 0;
      input.onUsage(usage);
      if (out.is_error) {
        const why = out.result?.replace(/\s*\n\s*/g, " ").slice(0, 200);
        throw new ReaderFailedError(
          `claude reported an error (${out.subtype})${why ? `: ${why}` : ""}`,
          await hitLimit(),
        );
      }
      const text = out.structured_output !== undefined ? JSON.stringify(out.structured_output) : (out.result ?? "");
      return { answer: parseAnswer(text), sessionId: out.session_id };
    };

    const first = await run(
      `Repository ${input.repo} at commit ${input.sha} (${blobs.size} files). Find its core files. Start with list("").`,
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
      await writeMcpConfig(await toolCalls());
      ({ answer } = await run(
        `Your answer was not usable: ${problems}. Reply again with the JSON answer only, using exact paths from the tree.`,
        first.sessionId,
      ));
      // AC 9: still no usable JSON answer after the repair run -> reader-failed (paths invalid -> invalid-output).
      if (answer.problem)
        throw new ReaderFailedError(`no answer after one repair run: ${answer.problem}`, await hitLimit());
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
      githubRateLimited: await githubRateLimited(),
      hitLimit: limited,
      totalTokens,
      tokens,
      dropped,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const ENV_NAMES = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "LANG",
  "TERM",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
]);
const ENV_PREFIXES = ["LC_", "XDG_", "CLAUDE_", "ANTHROPIC_"];

/** The child env is an allowlist: what the CLI needs (the subscription login lives in HOME), none of the app's
 *  secrets. ANTHROPIC_API_KEY never reaches the child; GITHUB_TOKEN goes only to the MCP server's own env. */
export function childEnv(parent: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(parent)) {
    if (v === undefined || k === "ANTHROPIC_API_KEY") continue;
    if (ENV_NAMES.has(k) || ENV_PREFIXES.some((p) => k.startsWith(p))) env[k] = v;
  }
  return env;
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
    "--system-prompt",
    SYSTEM_PROMPT,
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
    // Ignores user/project/local settings files and code-running tools (probe 2026-11-12, claude 2.1.322: the 3 MCP
    // tools and the subscription login still work).
    "--restricted",
    ...(input.modelId ? ["--model", input.modelId] : []),
    ...(resume ? ["--resume", resume] : []),
    "--allowedTools",
    ...ALLOWED_TOOLS,
  ];
  const env = childEnv(process.env);
  const timeoutMs = input.timeoutMs ?? CLAUDE_CODE_TIMEOUT_MS;
  // Its own process group, so the timeout kills claude and its MCP server child together.
  let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
  try {
    proc = Bun.spawn(argv, { cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe", detached: true });
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") throw new ReaderNotInstalledError(argv[0] as string);
    throw err;
  }
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let grace: ReturnType<typeof setTimeout> | undefined;
  // Resolves KILL_GRACE_MS after the timeout kill: a pipe still held open (a stray grandchild) is not awaited.
  const killed = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-proc.pid, "SIGKILL");
      } catch {
        proc.kill("SIGKILL");
      }
      grace = setTimeout(() => resolve(null), KILL_GRACE_MS);
    }, timeoutMs);
  });
  try {
    const out = await Promise.race([
      Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]),
      killed,
    ]);
    if (timedOut || !out) throw new Error(`claude timed out after ${timeoutMs} ms`);
    const [stdout, stderr, code] = out;
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
    clearTimeout(grace);
  }
}
