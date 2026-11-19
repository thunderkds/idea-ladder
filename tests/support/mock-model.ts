// AI SDK mock language model for the repo reader: each call returns the next scripted reply.
import type { LanguageModelV3CallOptions, LanguageModelV3GenerateResult } from "@ai-sdk/provider";
import { MockLanguageModelV3 } from "ai/test";
import type { ReaderDeps } from "../../src/server/ladder-generate.ts";
import type { ModelADeps } from "../../src/server/model-a.ts";

export type Reply = { tools: { name: string; input: unknown }[] } | { text: string } | { error: Error };

const usage = (input: number, output: number) => ({
  inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: output, text: output, reasoning: 0 },
});

/** `script(callIndex, options)` picks the reply; every call reports `tokensPerCall` input + 10 output tokens. */
export function scriptedModel(
  script: (call: number, options: LanguageModelV3CallOptions) => Reply,
  tokensPerCall = { input: 100, output: 10 },
) {
  let n = 0;
  let id = 0;
  const model = new MockLanguageModelV3({
    modelId: "test-model",
    doGenerate: async (options): Promise<LanguageModelV3GenerateResult> => {
      const reply = script(n++, options);
      if ("error" in reply) throw reply.error;
      const u = usage(tokensPerCall.input, tokensPerCall.output);
      if ("text" in reply) {
        return {
          content: [{ type: "text", text: reply.text }],
          finishReason: { unified: "stop", raw: "end_turn" },
          usage: u,
          warnings: [],
        };
      }
      return {
        content: reply.tools.map((t) => ({
          type: "tool-call" as const,
          toolCallId: `call-${++id}`,
          toolName: t.name,
          input: JSON.stringify(t.input),
        })),
        finishReason: { unified: "tool-calls", raw: "tool_use" },
        usage: u,
        warnings: [],
      };
    },
  });
  return model;
}

/** Text of every tool result the model was shown in one call. */
export function toolResults(options: LanguageModelV3CallOptions): string[] {
  return options.prompt.flatMap((m) =>
    m.role === "tool" ? m.content.flatMap((p) => (p.type === "tool-result" ? [JSON.stringify(p.output)] : [])) : [],
  );
}

export const answer = (files: { path: string; reason?: string }[]) =>
  JSON.stringify({ coreFiles: files.map((f) => ({ path: f.path, reason: f.reason ?? `core: ${f.path}` })) });

/**
 * Reader deps for workflow tests that are not about the reader: list("") once, then answer with the first three
 * root files from that listing. No GitHub call, no cost log.
 */
export function testReader(): Extract<ReaderDeps, { model: unknown }> {
  const model = scriptedModel((call, options) => {
    if (call % 2 === 0) return { tools: [{ name: "list", input: { path: "" } }] };
    const listing = JSON.parse(toolResults(options).at(-1) ?? '""') as { value?: string };
    const files = String(listing.value ?? "")
      .split("\n")
      .filter((l) => l.startsWith('"'))
      .map((l) => JSON.parse(l) as string)
      .filter((p) => !p.endsWith("/"));
    return { text: answer(files.slice(0, 3).map((path) => ({ path }))) };
  });
  return { model, limits: { maxSteps: 15, tokenBudget: 80_000 }, logCost: () => {} };
}

/** Concepts every `testModelA` answer holds; each rests on the snapshot's readme. */
export const TEST_CONCEPTS = ["Concept one", "Concept two", "Concept three"].map((name) => ({
  name,
  reason: `why ${name}`,
  basis: ["readme"],
}));

/** The JSON data line of a level generator prompt (T008), or undefined for another prompt. */
export function promptData(prompt: string): { level: string; chunks: { id: number }[] } | undefined {
  try {
    const data = JSON.parse(prompt.split("\n")[1] ?? "");
    return typeof data?.level === "string" ? data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A level answer with one card and one MCQ citing the first chunk the prompt gave (none when it gave none). The
 * MCQ key is the chunk's first word, so it passes the answer-key check (8c) with no regeneration.
 */
const testLevelAnswer = (prompt: string) => {
  const first = promptData(prompt)?.chunks[0] as { id: number; text?: string } | undefined;
  const id = first?.id;
  const key = first?.text?.match(/[\p{L}\p{N}]+/u)?.[0] ?? "a";
  return {
    goal: "Test goal",
    passTest: { kind: "model-kind", description: "Test pass test" },
    cards: id === undefined ? [] : [{ front: "Test front?", back: "Test back.", chunkId: id }],
    mcqs:
      id === undefined
        ? []
        : [{ question: "Test question?", options: [key, "option b", "option c", "option d"], key, chunkId: id }],
  };
};

/**
 * Model A dep for workflow tests that are not about the mapper: answers TEST_CONCEPTS to the mapper and a
 * testLevelAnswer to a level generator, no model call.
 */
export function testModelA(): ModelADeps {
  return {
    backend: "api",
    generate: async ({ schema, prompt }) => {
      const concepts = schema.safeParse({ concepts: TEST_CONCEPTS });
      return {
        value: concepts.success ? concepts.data : schema.parse(testLevelAnswer(prompt)),
        usage: { model: "test-model", inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
      };
    },
  };
}
