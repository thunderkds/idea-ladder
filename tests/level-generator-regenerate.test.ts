// T008 (8c) AC 4 / Success Criterion 2: a failing answer key is regenerated with the reason, at most 2 times.
import { describe, expect, test } from "bun:test";
import {
  checkMcqKey,
  generateLevel,
  type LevelChunk,
  MAX_REGENERATIONS,
  OneMcqSchema,
  regenerateMcq,
} from "../src/server/level-generator.ts";
import { type Generate, type GenerateInput, ModelAInvalidOutputError } from "../src/server/model-a.ts";
import type { CallUsage } from "../src/server/repo-reader.ts";

const USAGE: CallUsage = { model: "test-model", inputTokens: 5, outputTokens: 2, cachedInputTokens: 0 };
const chunk = (id: number, text: string): LevelChunk => ({
  id,
  source: "core",
  path: `src/f${id}.ts`,
  startLine: 1,
  endLine: 3,
  text,
});
const MAP = [chunk(21, "uses a map"), chunk(22, "emit calls each handler")];
const mcq = (key: string, chunkId = 21, options = [key, "set", "array", "list"]) => ({
  question: "What stores the handlers?",
  options,
  key,
  chunkId,
});

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

describe("regenerateMcq", () => {
  test("one model call with the one-item schema, the failure reason and the same chunks the level saw", async () => {
    const { generate, inputs } = scripted([{ mcq: mcq("map") }]);
    const usages: CallUsage[] = [];
    const out = await regenerateMcq({
      level: "L3",
      chunks: MAP,
      mcq: mcq("bitmap"),
      reason: "the key is not in the chunk",
      generate,
      onUsage: (u) => usages.push(u),
    });
    expect(out).toEqual({ mcq: mcq("map") });
    expect(inputs).toHaveLength(1);
    expect(inputs[0]?.schema).toBe(OneMcqSchema);
    const lines = inputs[0]?.prompt.split("\n") ?? [];
    expect(JSON.parse(lines[1] ?? "").chunks.map((c: { id: number }) => c.id)).toEqual([21, 22]);
    expect(lines[2]).toContain("the key is not in the chunk");
    expect(lines[2]).toContain('"bitmap"');
    expect(usages).toEqual([USAGE]);
  });
  test("the same citation and options checks: a chunk not given, or duplicate options, is a problem", async () => {
    const cite = await regenerateMcq({
      level: "L3",
      chunks: MAP,
      mcq: mcq("x"),
      reason: "r",
      generate: scripted([{ mcq: mcq("map", 99) }]).generate,
    });
    expect(cite.problem).toBe("chunk 99 is not in the data");
    const opts = await regenerateMcq({
      level: "L3",
      chunks: MAP,
      mcq: mcq("x"),
      reason: "r",
      generate: scripted([{ mcq: mcq("map", 21, ["map", "Map", "set", "list"]) }]).generate,
    });
    expect(opts.problem).toBe("the 4 options are not all different");
  });
  test("an answer that does not fit the schema is a problem, not a throw", async () => {
    const err = new ModelAInvalidOutputError("not json", USAGE);
    const usages: CallUsage[] = [];
    const out = await regenerateMcq({
      level: "L3",
      chunks: MAP,
      mcq: mcq("x"),
      reason: "r",
      generate: scripted([err]).generate,
      onUsage: (u) => usages.push(u),
    });
    expect(out.mcq).toBeUndefined();
    expect(out.problem).toContain("did not fit the schema");
    expect(usages).toEqual([USAGE]);
  });
});

describe("checkMcqKey (AC 4)", () => {
  test("a key that passes is kept with no model call", async () => {
    const { generate, inputs } = scripted([]);
    expect(await checkMcqKey({ level: "L3", chunks: MAP, mcq: mcq("map"), generate })).toEqual(mcq("map"));
    expect(inputs).toHaveLength(0);
  });
  test("a failing key is replaced by the first regeneration that passes", async () => {
    const { generate, inputs } = scripted([{ mcq: mcq("bitmap") }, { mcq: mcq("map") }]);
    expect(await checkMcqKey({ level: "L3", chunks: MAP, mcq: mcq("bitmap"), generate })).toEqual(mcq("map"));
    expect(inputs).toHaveLength(2);
  });
  test("a regeneration that cites a chunk not given counts as a failed attempt", async () => {
    const { generate, inputs } = scripted([{ mcq: mcq("map", 99) }, { mcq: mcq("map", 99) }]);
    expect(await checkMcqKey({ level: "L3", chunks: MAP, mcq: mcq("bitmap"), generate })).toBeUndefined();
    expect(inputs).toHaveLength(MAX_REGENERATIONS);
    expect(inputs[1]?.prompt).toContain("chunk 99 is not in the data");
  });

  test("Success Criterion 2: key `bitmap`, chunk `uses a map` -> regenerated twice, dropped; 3 model calls", async () => {
    const level = {
      goal: "g",
      passTest: { kind: "k", description: "d" },
      cards: [],
      mcqs: [mcq("bitmap")],
    };
    const { generate, inputs } = scripted([level, { mcq: mcq("bitmap") }, { mcq: mcq("bitmap") }, { mcq: mcq("map") }]);
    const out = await generateLevel({ level: "L3", chunks: MAP, generate });
    expect(out.mcqs).toEqual([mcq("bitmap")]); // the generator keeps it: the key check is 8c's
    const kept = await checkMcqKey({ level: "L3", chunks: MAP, mcq: out.mcqs[0] as never, generate });
    expect(kept).toBeUndefined(); // the caller drops it key-check-failed
    expect(inputs).toHaveLength(3); // 1 generation + 2 regenerations; the 4th answer is never asked for
    expect(inputs[1]?.prompt).toContain("does not occur in the text of chunk 21");
    expect(inputs[2]?.prompt).toContain("does not occur in the text of chunk 21");
  });
});
