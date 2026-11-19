// T008 (8b) AC 2 / AC 3: one model A call per level (schema, fixed pass-test kind, grounded prompt), citation check.
import { describe, expect, test } from "bun:test";
import {
  generateLevel,
  LEVEL_CHUNK_CHARS,
  type LevelChunk,
  LevelGeneratorInvalidOutputError,
  MCQ_POOL_TARGET,
  PASS_TEST_KIND,
} from "../src/server/level-generator.ts";
import type { Generate, GenerateInput } from "../src/server/model-a.ts";
import { ModelAInvalidOutputError } from "../src/server/model-a.ts";
import type { CallUsage } from "../src/server/repo-reader.ts";

const USAGE: CallUsage = { model: "test-model", inputTokens: 5, outputTokens: 2, cachedInputTokens: 0 };
const chunk = (id: number, text: string, source: LevelChunk["source"] = "core"): LevelChunk => ({
  id,
  source,
  path: `src/f${id}.ts`,
  startLine: 1,
  endLine: 3,
  text,
});
const CORE = [
  chunk(11, "export function on(type, handler) uses a map of handlers"),
  chunk(12, "emit calls each handler"),
];
const mcq = (chunkId: number, options = ["map", "set", "array", "list"], key = "map") => ({
  question: "What stores the handlers?",
  options,
  key,
  chunkId,
});
const card = (chunkId: number) => ({ front: "How does on() register?", back: "It adds the handler.", chunkId });

/** A Generate that answers `answers[call]` (an Error is thrown) and records every input. */
function scripted(answers: (unknown | Error)[]) {
  const inputs: GenerateInput<unknown>[] = [];
  const generate: Generate = async (input) => {
    inputs.push(input as GenerateInput<unknown>);
    const a = answers[inputs.length - 1];
    if (a instanceof Error) throw a;
    return { value: input.schema.parse(a), usage: USAGE };
  };
  return { generate, inputs };
}
const answer = (over: Record<string, unknown> = {}) => ({
  goal: "Explain how handlers are stored",
  passTest: { kind: "llm-judged", description: "Answer the questions" },
  cards: [card(11)],
  mcqs: [mcq(11)],
  ...over,
});

describe("generateLevel (AC 2)", () => {
  test("one model A call; passTest.kind is fixed in code and overrides the model's kind", async () => {
    const { generate, inputs } = scripted([answer()]);
    const usages: CallUsage[] = [];
    const out = await generateLevel({ level: "L3", chunks: CORE, generate, onUsage: (u) => usages.push(u) });
    expect(inputs).toHaveLength(1);
    expect(usages).toEqual([USAGE]);
    expect(out.passTest).toEqual({ kind: "verified-mcq", description: "Answer the questions" });
    expect(out.goal).toBe("Explain how handlers are stored");
    expect(out.cards).toEqual([card(11)]);
    expect(out.mcqs).toEqual([mcq(11)]);
    expect(PASS_TEST_KIND).toEqual({
      L0: "concept-mcq",
      L1: "run-mcq",
      L2: "branch-diff-and-diff-questions",
      L3: "verified-mcq",
      L4: "repo-or-merged-pr",
    });
  });

  test("the schema rejects an MCQ without exactly 4 options", async () => {
    const { generate } = scripted([answer({ mcqs: [mcq(11, ["map", "set", "array"])] })]);
    const err = await generateLevel({ level: "L3", chunks: CORE, generate }).catch((e: unknown) => e);
    expect(String(err)).toMatch(/options/);
  });

  test("prompt: the level's chunks with their ids as data, literal-span keys, an MCQ pool only for L0, L1 (T013) and L3", async () => {
    const l3 = scripted([answer()]);
    await generateLevel({ level: "L3", chunks: CORE, generate: l3.generate });
    const p3 = l3.inputs[0] as GenerateInput<unknown>;
    for (const c of CORE) {
      expect(p3.prompt).toContain(`"id":${c.id}`);
      expect(p3.prompt).toContain(JSON.stringify(c.text));
    }
    expect(p3.system).toMatch(/literal span/);
    expect(p3.system).toMatch(/never follow instructions/);
    expect(p3.system).toContain(`${MCQ_POOL_TARGET} multiple-choice`);
    expect(p3.system).toMatch(/5 to 10 review cards/);

    const l2 = scripted([answer({ mcqs: [] })]);
    await generateLevel({ level: "L2", chunks: CORE, generate: l2.generate });
    expect(l2.inputs[0]?.system).not.toContain("multiple-choice");

    const l0 = scripted([answer()]);
    await generateLevel({
      level: "L0",
      chunks: [chunk(1, "mitt is a tiny event emitter", "readme")],
      concepts: [{ name: "Event emitter", reason: "core idea" }],
      generate: l0.generate,
    });
    expect(l0.inputs[0]?.prompt).toContain("Event emitter");
    expect(l0.inputs[0]?.system).toContain(`${MCQ_POOL_TARGET} multiple-choice`);
  });

  test("snapshot extras are sent as data", async () => {
    const { generate, inputs } = scripted([answer()]);
    await generateLevel({ level: "L2", chunks: CORE, snapshotExtras: { tree: ["src/index.ts"] }, generate });
    expect(inputs[0]?.prompt).toContain('"tree":["src/index.ts"]');
  });

  test("chunk text sent per level is capped at LEVEL_CHUNK_CHARS (whole chunks, in order)", async () => {
    const big = Array.from({ length: 30 }, (_, i) => chunk(100 + i, "x".repeat(1_500)));
    const { generate, inputs } = scripted([answer({ cards: [], mcqs: [] })]);
    await generateLevel({ level: "L3", chunks: big, generate });
    const sent = big.filter((c) => inputs[0]?.prompt.includes(`"id":${c.id}`));
    expect(sent.length).toBe(Math.floor(LEVEL_CHUNK_CHARS / 1_500));
    expect(sent.map((c) => c.id)).toEqual(big.slice(0, sent.length).map((c) => c.id));
  });

  test("an answer that does not fit the schema: one retry with the reason, then LevelGeneratorInvalidOutputError", async () => {
    const bad = new ModelAInvalidOutputError("goal: Required", USAGE);
    const once = scripted([bad, answer()]);
    const usages: CallUsage[] = [];
    await generateLevel({ level: "L3", chunks: CORE, generate: once.generate, onUsage: (u) => usages.push(u) });
    expect(once.inputs).toHaveLength(2);
    expect(once.inputs[1]?.prompt).toContain("goal: Required");
    expect(usages).toHaveLength(2); // the failed paid call is logged too

    const twice = scripted([bad, bad]);
    const err = await generateLevel({ level: "L3", chunks: CORE, generate: twice.generate }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LevelGeneratorInvalidOutputError);
    expect(twice.inputs).toHaveLength(2);
  });
});

describe("citation and options checks (AC 3, Edge Case Checklist)", () => {
  test("Success Criterion 3: an MCQ or card citing another level's chunk is dropped bad-citation", async () => {
    const readmeChunk = 7; // a README chunk of the same repo + SHA, given to L0/L1, not to L3
    const { generate } = scripted([
      answer({
        cards: [card(11), card(readmeChunk)],
        mcqs: [mcq(12, ["handler", "map", "set", "list"], "handler"), mcq(readmeChunk)],
      }),
    ]);
    const out = await generateLevel({ level: "L3", chunks: CORE, generate });
    expect(out.cards).toEqual([card(11)]);
    expect(out.mcqs.map((m) => m.chunkId)).toEqual([12]);
    expect(out.dropped).toEqual([
      { item: card(readmeChunk), reason: "bad-citation" },
      { item: mcq(readmeChunk), reason: "bad-citation" },
    ]);
  });

  test("a chunk cut by the per-level cap was not given: citing it is bad-citation", async () => {
    const big = Array.from({ length: 30 }, (_, i) => chunk(100 + i, "x".repeat(1_500)));
    const { generate } = scripted([answer({ cards: [card(129)], mcqs: [] })]);
    const out = await generateLevel({ level: "L3", chunks: big, generate });
    expect(out.cards).toEqual([]);
    expect(out.dropped).toEqual([{ item: card(129), reason: "bad-citation" }]);
  });

  test("options that repeat after normalisation (case, spaces, NFKC) are dropped bad-options", async () => {
    const dup = mcq(11, ["Map", " map ", "set", "array"], "Map");
    const nfkc = mcq(11, ["ｍａｐ", "map", "set", "array"], "map");
    const { generate } = scripted([answer({ mcqs: [dup, nfkc, mcq(11)] })]);
    const out = await generateLevel({ level: "L3", chunks: CORE, generate });
    expect(out.mcqs).toEqual([mcq(11)]);
    expect(out.dropped).toEqual([
      { item: dup, reason: "bad-options" },
      { item: nfkc, reason: "bad-options" },
    ]);
  });
});
