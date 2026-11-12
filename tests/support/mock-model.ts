// AI SDK mock language model for the repo reader: each call returns the next scripted reply.
import type { LanguageModelV3CallOptions, LanguageModelV3GenerateResult } from "@ai-sdk/provider";
import { MockLanguageModelV3 } from "ai/test";
import type { ReaderDeps } from "../../src/server/ladder-generate.ts";

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
export function testReader(): ReaderDeps {
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
