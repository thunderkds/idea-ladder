// T014: a learner's L2 diff in GitHub's compare response shape (fields trimmed to the ones read), plus scripted model
// A answers and an AI SDK mock model B. Hand-built from the REST docs like tests/support/t013-github.ts: no network.
import type { LanguageModelV3CallOptions } from "@ai-sdk/provider";
import type { DiffMcq } from "../../src/server/diff-questions.ts";
import { type Generate, ModelAInvalidOutputError } from "../../src/server/model-a.ts";
import type { Fixture, FixtureEntry } from "./github-fixtures.ts";
import { scriptedModel } from "./mock-model.ts";

export const REPO = "learner-a/proj";
export const BASE_SHA = "1".repeat(40);
export const HEAD_SHA = "2".repeat(40);
export const HEAD_SHA_2 = "6".repeat(40);
export const comparePath = (head = HEAD_SHA) => `/repos/${REPO}/compare/${BASE_SHA}...${head}?per_page=1&page=1`;

const RETRY_PATCH = [
  "@@ -1,4 +1,6 @@",
  " export function retry(fn) {",
  "+  const maxAttempts = 3;",
  "+  const delayMs = 250;",
  "   return fn();",
  "@@ -20,3 +22,3 @@ export function backoff(attempt) {",
  "-  return 100 * attempt;",
  "+  return delayMs * 2 ** attempt;",
].join("\n");
const CONFIG_PATCH = ["@@ -1,2 +1,3 @@", " export const config = {", "+  timeoutSeconds: 30,", '   name: "app",'].join(
  "\n",
);

const H = { "content-type": "application/json; charset=utf-8", "x-ratelimit-remaining": "4990" };
const json = (body: unknown): FixtureEntry => ({ status: 200, headers: H, body: JSON.stringify(body) });

/** 3 hunks (src/retry.ts#0, src/retry.ts#1, src/config.ts#0) plus a lockfile and a binary file that are filtered out. */
export const DIFF_FILES = [
  { filename: "src/retry.ts", status: "modified", additions: 3, deletions: 1, patch: RETRY_PATCH },
  { filename: "src/config.ts", status: "modified", additions: 1, deletions: 0, patch: CONFIG_PATCH },
  { filename: "bun.lock", status: "modified", additions: 1, deletions: 1, patch: "@@ -1 +1 @@\n-a\n+b" },
  { filename: "logo.png", status: "added", additions: 0, deletions: 0 },
];
export const LOCK_ONLY_FILES = [DIFF_FILES[2]];

export function diffFixture(files: unknown[] = DIFF_FILES, head = HEAD_SHA): Fixture {
  return {
    fullName: REPO,
    sha: head,
    recordedAt: "hand-built",
    entries: {
      [comparePath(head)]: json({ status: "ahead", total_commits: 2, commits: [{ sha: head }], files }),
    },
  };
}

/** A question model A may write: key = a literal span of the cited hunk. */
export const q = (question: string, key: string, citedHunkId: string, others: string[]): DiffMcq => ({
  question,
  options: [key, ...others],
  key,
  citedHunkId,
});
/** Five valid questions, each about a different line of the diff. */
export const GOOD: DiffMcq[] = [
  q("Which constant caps how many tries retry makes?", "maxAttempts", "src/retry.ts#0", ["delay", "limit", "count"]),
  q("How many milliseconds does the new delay constant hold?", "250", "src/retry.ts#0", ["100", "500", "1000"]),
  q("What did backoff multiply by before your change?", "100", "src/retry.ts#1", ["250", "2", "10"]),
  q("Which config field did you add?", "timeoutSeconds", "src/config.ts#0", ["timeoutMs", "retries", "name"]),
  q("What value does the timeout field get?", "30", "src/config.ts#0", ["60", "10", "300"]),
];
/** Two more valid questions (regeneration rounds, retakes). */
export const EXTRA: DiffMcq[] = [
  q("Which name now scales the backoff result?", "delayMs", "src/retry.ts#1", ["maxAttempts", "fn", "config"]),
  q("Which function wraps fn in the retry file?", "retry", "src/retry.ts#0", ["backoff", "wrap", "call"]),
  q("Which parameter does backoff take?", "attempt", "src/retry.ts#1", ["fn", "tries", "ms"]),
  q("What object holds the new timeout?", "config", "src/config.ts#0", ["settings", "env", "options"]),
  q("Which string stays as the config name?", "app", "src/config.ts#0", ["proj", "main", "retry"]),
];

/** Model A on the `generate` interface (T007): answers round n with `rounds[n]` (the last one repeats); counts calls. */
export function scriptedModelA(rounds: (DiffMcq[] | Error)[]) {
  const prompts: string[] = [];
  const generate: Generate = async ({ schema, prompt }) => {
    prompts.push(prompt);
    const answer = rounds[Math.min(prompts.length - 1, rounds.length - 1)] as DiffMcq[] | Error;
    if (answer instanceof Error) throw answer;
    return {
      value: schema.parse({ questions: answer }),
      usage: { model: "mock-a", inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
    };
  };
  return { modelA: { backend: "api" as const, generate }, calls: () => prompts.length, prompts };
}
export const invalidOutput = () => new ModelAInvalidOutputError("not JSON");

/** The JSON data model B was shown (T009 blind-solve prompt: line 2). */
export function blindData(options: LanguageModelV3CallOptions): { chunk: string; question: string; options: string[] } {
  const user = options.prompt.find((m) => m.role === "user");
  const text = user && Array.isArray(user.content) ? user.content.map((p) => ("text" in p ? p.text : "")).join("") : "";
  return JSON.parse(text.split("\n")[1] ?? "{}");
}

/**
 * Model B as an AI SDK mock language model (`ai/test`). `pick` sees only what the blind solver sends (question,
 * shown options, chunk) and returns the chosen option text, or an Error to throw. `seen` records every prompt.
 */
export function mockModelB(pick: (d: { chunk: string; question: string; options: string[] }) => string | Error) {
  const seen: { chunk: string; question: string; options: string[]; raw: string }[] = [];
  const model = scriptedModel((_call, options) => {
    const d = blindData(options);
    seen.push({ ...d, raw: JSON.stringify(options.prompt) });
    const choice = pick(d);
    if (choice instanceof Error) return { error: choice };
    return { text: JSON.stringify({ answerIndex: Math.max(d.options.indexOf(choice), 0) }) };
  });
  return { model, seen };
}

/** What a learner who knows the code would pick: the option that is the fixture key of that question text. */
export const KEYS = new Map([...GOOD, ...EXTRA].map((m) => [m.question, m.key]));
export const knows = (d: { question: string }) => KEYS.get(d.question) ?? "";
/** Picks any option that is not the key. */
export const wrong = (d: { question: string; options: string[] }) =>
  d.options.find((o) => o !== KEYS.get(d.question)) as string;
