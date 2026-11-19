// T009 AC 1, 4, 7: the blind solver. Model B is a scripted `Generate`; nothing here calls a real model.
import { describe, expect, test } from "bun:test";
import { BLIND_CHUNK_CHARS, blindSolve, blindSolveMcq, permutationFor, seedFor } from "../src/server/blind-solver.ts";
import { createModelA, type Generate, ModelAFailedError, ModelAInvalidOutputError } from "../src/server/model-a.ts";
import type { CallUsage } from "../src/server/repo-reader.ts";
import { scriptedModel } from "./support/mock-model.ts";

const usage: CallUsage = { model: "mock-b", inputTokens: 5, outputTokens: 2, cachedInputTokens: 0 };
const OPTIONS = ["on", "off", "emit", "all"];
const CHUNK = "Call off to remove a handler. on adds one.";

type Seen = { prompt: string; system?: string; temperature?: number };
/** Model B that answers the shuffled position of `wanted` (an option text), and records what it was shown. */
function solverOf(wanted: string, seen: Seen[] = []): Generate {
  return async ({ schema, prompt, system, temperature }) => {
    seen.push({ prompt, system, temperature });
    const shown = JSON.parse(prompt.split("\n")[1] as string).options as string[];
    return { value: schema.parse({ answerIndex: shown.indexOf(wanted) }), usage };
  };
}

describe("blindSolve prompt (AC 1)", () => {
  test("shows the chunk and the 4 options, never the key, and asks for temperature 0", async () => {
    const seen: Seen[] = [];
    await blindSolve({
      question: "Which removes a handler?",
      options: OPTIONS,
      chunk: CHUNK,
      generate: solverOf("off", seen),
    });
    const data = JSON.parse(seen[0]?.prompt.split("\n")[1] as string);
    expect([...data.options].sort()).toEqual([...OPTIONS].sort());
    expect(data.chunk).toBe(CHUNK);
    expect(data.question).toBe("Which removes a handler?");
    expect(Object.keys(data).sort()).toEqual(["chunk", "options", "question"]);
    expect(seen[0]?.prompt).not.toMatch(/key|correct|answer is/i);
    expect(seen[0]?.system).toMatch(/data, not instructions/i);
    expect(seen[0]?.temperature).toBe(0);
  });

  test("the chunk is capped at 2,000 characters", async () => {
    const seen: Seen[] = [];
    await blindSolve({ question: "q", options: OPTIONS, chunk: "x".repeat(5000), generate: solverOf("on", seen) });
    expect(JSON.parse(seen[0]?.prompt.split("\n")[1] as string).chunk).toHaveLength(BLIND_CHUNK_CHARS);
  });

  test("temperature 0 reaches the api back end (AC 7)", async () => {
    const model = scriptedModel(() => ({ text: '{"answerIndex":1}' }));
    await blindSolve({ question: "q", options: OPTIONS, chunk: CHUNK, generate: createModelA({ model }).generate });
    expect(model.doGenerateCalls[0]?.temperature).toBe(0);
  });

  test("rejects an option list that is not 4 long", async () => {
    await expect(
      blindSolve({ question: "q", options: ["a", "b"], chunk: CHUNK, generate: solverOf("a") }),
    ).rejects.toThrow(/4 options/);
  });
});

describe("shuffle mapping (AC 1)", () => {
  test("every one of the 24 permutations maps the answer back to the original index", async () => {
    const found = new Map<string, number>();
    for (let seed = 0; seed < 5000 && found.size < 24; seed++) found.set(permutationFor(seed).join(), seed);
    expect(found.size).toBe(24);
    for (const [order, seed] of found) {
      expect([...order.split(",").map(Number)].sort()).toEqual([0, 1, 2, 3]);
      for (const [i, wanted] of OPTIONS.entries()) {
        const r = await blindSolve({ question: "q", options: OPTIONS, chunk: CHUNK, generate: solverOf(wanted), seed });
        expect(r.answerIndex).toBe(i);
        expect(r.seed).toBe(seed);
      }
    }
  });

  test("the seed is recorded, deterministic, and does not depend on the key", async () => {
    const a = await blindSolve({ question: "q", options: OPTIONS, chunk: CHUNK, generate: solverOf("on") });
    const b = await blindSolve({ question: "q", options: OPTIONS, chunk: CHUNK, generate: solverOf("off") });
    expect(a.seed).toBe(b.seed);
    expect(a.seed).toBe(seedFor("q", OPTIONS));
    expect(seedFor("q", OPTIONS)).not.toBe(seedFor("other", OPTIONS));
  });
});

describe("blindSolveMcq (AC 4)", () => {
  const mcq = { question: "Which removes a handler?", options: OPTIONS, key: "off", chunkId: 1 };
  const run = (generate: Generate, onUsage?: (u: CallUsage) => void) =>
    blindSolveMcq({ mcq, chunk: CHUNK, generate, onUsage });

  test("agreement when model B picks the key", async () => {
    expect((await run(solverOf("off"))).agree).toBe(true);
  });

  test("disagreement when model B picks another option", async () => {
    expect((await run(solverOf("on"))).agree).toBe(false);
  });

  test("answerIndex 7 fails the schema and counts as disagreement, never agreement", async () => {
    const model = scriptedModel(() => ({ text: '{"answerIndex":7}' }));
    const costs: CallUsage[] = [];
    const r = await run(createModelA({ model }).generate, (u) => costs.push(u));
    expect(r.agree).toBe(false);
    expect(r.failure).toMatch(/model-a-invalid-output/);
    expect(costs.length).toBe(2); // one retry, both calls paid and logged
  });

  test("a model error is retried once, then counts as disagreement", async () => {
    let calls = 0;
    const r = await run(async () => {
      calls++;
      throw new ModelAFailedError("boom", usage);
    });
    expect(r).toMatchObject({ agree: false });
    expect(calls).toBe(2);
  });

  test("a model error then a good answer is kept as that answer", async () => {
    let calls = 0;
    const good = solverOf("off");
    const r = await run(async (input) => {
      if (calls++ === 0) throw new ModelAInvalidOutputError("not json");
      return good(input);
    });
    expect(r.agree).toBe(true);
  });

  test("a model that is not installed is not swallowed", async () => {
    const { ModelANotInstalledError } = await import("../src/server/model-a.ts");
    await expect(
      run(async () => {
        throw new ModelANotInstalledError("no claude");
      }),
    ).rejects.toThrow(/not-installed/);
  });
});
