import { MockLanguageModelV3 } from 'ai/test';

type Usage = { input?: number; output?: number; cacheRead?: number };
export type Scripted =
  | { tool: string; input: Record<string, unknown>; usage?: Usage }
  | { text: string; usage?: Usage }
  | { throws: Error };

const usageOf = (u: Usage = {}) => {
  const input = u.input ?? 100;
  const cacheRead = u.cacheRead ?? 0;
  const output = u.output ?? 20;
  return {
    inputTokens: { total: input, noCache: input - cacheRead, cacheRead, cacheWrite: 0 },
    outputTokens: { total: output, text: output, reasoning: 0 },
  };
};

/**
 * A model that answers from a script, one entry per call. `repeat` entries are used again and again once the
 * script is spent (a model that never stops calling tools). The model sees its own `calls` (the AI SDK call options).
 */
export function scriptedModel(script: Scripted[] | ((callNumber: number, prompt: unknown) => Scripted), modelId = 'test-model') {
  let n = 0;
  const model = new MockLanguageModelV3({
    modelId,
    doGenerate: async (options) => {
      const entry = typeof script === 'function' ? script(n, options.prompt) : (script[n] ?? script.at(-1)!);
      n++;
      if ('throws' in entry) throw entry.throws;
      if ('tool' in entry) {
        return {
          content: [{ type: 'tool-call' as const, toolCallId: `call-${n}`, toolName: entry.tool, input: JSON.stringify(entry.input) }],
          finishReason: { unified: 'tool-calls' as const, raw: 'tool_use' },
          usage: usageOf(entry.usage),
          warnings: [],
        };
      }
      return {
        content: [{ type: 'text' as const, text: entry.text }],
        finishReason: { unified: 'stop' as const, raw: 'end_turn' },
        usage: usageOf(entry.usage),
        warnings: [],
      };
    },
  });
  return model;
}

export const answer = (...entries: Array<[string, string]>): Scripted => ({
  text: JSON.stringify({ coreFiles: entries.map(([path, reason]) => ({ path, reason })) }),
});
