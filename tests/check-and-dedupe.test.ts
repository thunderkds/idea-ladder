// T008 (8c) AC 4-6: checkAndDedupe on generated levels: key check -> regenerate (max 2) -> verbatim -> dedupe.
import { describe, expect, test } from "bun:test";
import { checkAndDedupe, type GeneratedLevel, type LadderLevel } from "../src/server/check-and-dedupe.ts";
import type { LevelChunk } from "../src/server/level-generator.ts";
import type { Generate, GenerateInput } from "../src/server/model-a.ts";
import type { CallUsage } from "../src/server/repo-reader.ts";

const USAGE: CallUsage = { model: "test-model", inputTokens: 5, outputTokens: 2, cachedInputTokens: 0 };
const WORDS30 = Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ");
const CHUNKS: LevelChunk[] = [
  { id: 1, source: "readme", path: "README.md", startLine: 1, endLine: 5, text: `mitt is a tiny emitter. ${WORDS30}` },
  {
    id: 2,
    source: "core",
    path: "src/index.ts",
    startLine: 1,
    endLine: 9,
    text: "uses a map of handlers; emit calls each",
  },
];
const mcq = (key: string, chunkId = 2, question = "What stores the handlers?") => ({
  question,
  options: [key, "set", "array", "list"],
  key,
  chunkId,
});
const card = (front: string, chunkId = 2, back = "An answer.") => ({ front, back, chunkId });
const level = (l: "L0" | "L3", over: Partial<GeneratedLevel> = {}): GeneratedLevel => ({
  level: l,
  status: "generated",
  goal: "g",
  passTest: { kind: l === "L0" ? "concept-mcq" : "verified-mcq", description: "d" },
  cards: [],
  mcqs: [],
  dropped: [],
  ...over,
});
const skipped = (l: "L1" | "L2" | "L4"): LadderLevel => ({ level: l, status: "skipped", kind: "concept-only-skipped" });

function scripted(answers: unknown[]) {
  const inputs: GenerateInput<unknown>[] = [];
  const generate: Generate = async (input) => {
    inputs.push(input as GenerateInput<unknown>);
    return { value: input.schema.parse(answers[inputs.length - 1]), usage: USAGE };
  };
  return { generate, inputs };
}
const run = (levels: LadderLevel[], generate: Generate, dedupeJaccard = 0.8) =>
  checkAndDedupe({ levels, chunks: CHUNKS, generate, dedupeJaccard });

describe("checkAndDedupe", () => {
  test("Success Criterion 2 in the pipeline: a key that never passes is dropped key-check-failed after 2 regenerations", async () => {
    const bad = mcq("bitmap");
    const { generate, inputs } = scripted([{ mcq: bad }, { mcq: bad }]);
    const [l3] = (await run([level("L3", { mcqs: [bad] })], generate)) as GeneratedLevel[];
    expect(l3?.mcqs).toEqual([]);
    expect(l3?.dropped).toEqual([{ item: bad, reason: "key-check-failed" }]);
    expect(inputs).toHaveLength(2);
    // The regeneration got the level's chunks only (L3: core).
    expect(JSON.parse(inputs[0]?.prompt.split("\n")[1] ?? "").chunks.map((c: { id: number }) => c.id)).toEqual([2]);
  });
  test("a regenerated MCQ that passes replaces the failing one", async () => {
    const { generate } = scripted([{ mcq: mcq("map") }]);
    const [l3] = (await run([level("L3", { mcqs: [mcq("bitmap")] })], generate)) as GeneratedLevel[];
    expect(l3?.mcqs).toEqual([mcq("map")]);
    expect(l3?.dropped).toEqual([]);
  });
  test("Success Criterion 5 in the pipeline: a card or question copying 30 words of a chunk is dropped verbatim-copy", async () => {
    const copyCard = card("Short front?", 1, `It says ${WORDS30}.`);
    const copyMcq = mcq("mitt", 1, `Which name fits: ${WORDS30}?`);
    const { generate } = scripted([]);
    const [l0] = (await run(
      [level("L0", { cards: [copyCard, card("Own words?", 1)], mcqs: [copyMcq] })],
      generate,
    )) as GeneratedLevel[];
    expect(l0?.cards).toEqual([card("Own words?", 1)]);
    expect(l0?.mcqs).toEqual([]);
    expect(l0?.dropped.map((d) => [d.item, d.reason])).toEqual([
      [copyMcq, "verbatim-copy"],
      [copyCard, "verbatim-copy"],
    ]);
  });
  test("the answer key is exempt from the verbatim check", async () => {
    const longKey = mcq(WORDS30, 1, "Which words follow the intro?");
    const [l0] = (await run([level("L0", { mcqs: [longKey] })], scripted([]).generate)) as GeneratedLevel[];
    expect(l0?.mcqs).toEqual([longKey]);
  });
  test("Success Criterion 3 in the pipeline: two cards that differ by one word -> the second is dropped duplicate", async () => {
    const a = "Which structure does the emitter use to store every registered handler function?";
    const b = "Which structure does the emitter use to store every registered listener function?";
    const [l3] = (await run([level("L3", { cards: [card(a), card(b)] })], scripted([]).generate)) as GeneratedLevel[];
    expect(l3?.cards).toEqual([card(a)]);
    expect(l3?.dropped).toEqual([{ item: card(b), reason: "duplicate" }]);
  });
  test("two MCQs on different facts of one chunk are both kept", async () => {
    const m1 = mcq("map", 2, "What stores the handlers?");
    const m2 = mcq("each", 2, "What does emit do with them?");
    const [l3] = (await run([level("L3", { mcqs: [m1, m2] })], scripted([]).generate)) as GeneratedLevel[];
    expect(l3?.mcqs).toEqual([m1, m2]);
    expect(l3?.dropped).toEqual([]);
  });
  test("dedupe order is level order L0 -> L4, then MCQs before cards; config cutoff is used", async () => {
    const levels: LadderLevel[] = [
      level("L0", { cards: [card("What stores the handlers?", 1)] }),
      skipped("L1"),
      level("L3", { mcqs: [mcq("map")], cards: [card("What stores the handlers?")] }),
    ];
    const out = (await run(levels, scripted([]).generate)) as GeneratedLevel[];
    expect(out[0]?.cards).toHaveLength(1);
    expect(out[1]).toEqual(skipped("L1") as never);
    expect(out[2]?.mcqs).toEqual([]); // the L0 card came first
    expect(out[2]?.dropped.map((d) => d.reason)).toEqual(["duplicate", "duplicate"]);
    const strict = (await run(
      [level("L0", { cards: [card("a b c d e f g h i j", 1), card("a b c d e f g h i k", 1)] })],
      scripted([]).generate,
      1,
    )) as GeneratedLevel[];
    expect(strict[0]?.cards).toHaveLength(2); // cutoff 1: only identical word sets repeat
  });
  test("drops from the generator (bad-citation, bad-options) are kept first; skipped levels pass through", async () => {
    const prior = [{ item: mcq("map", 99), reason: "bad-citation" }];
    const out = await run([level("L3", { dropped: prior }), skipped("L4")], scripted([]).generate);
    expect(out).toEqual([level("L3", { dropped: prior }), skipped("L4")]);
  });
  test("costs: one usage per regeneration call", async () => {
    const usages: CallUsage[] = [];
    const { generate } = scripted([{ mcq: mcq("map") }]);
    await checkAndDedupe({
      levels: [level("L3", { mcqs: [mcq("bitmap")], cards: [card("F?")] })],
      chunks: CHUNKS,
      generate,
      dedupeJaccard: 0.8,
      onUsage: (u) => usages.push(u),
    });
    expect(usages).toEqual([USAGE]);
  });
});
