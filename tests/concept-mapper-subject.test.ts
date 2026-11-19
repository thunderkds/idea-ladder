// T007 AC 7: the concept-mapper eval subject, offline with a mocked model A `generate`.
import { describe, expect, test } from "bun:test";
import { createConceptMapperSubject } from "../eval/src/concept-mapper-subject.ts";
import { loadFixture, loadGolden } from "../eval/src/golden.ts";
import { renderMarkdown, runEval } from "../eval/src/harness.ts";
import type { Generate } from "../src/server/model-a.ts";

const repos = loadGolden().slice(0, 2);
const usage = { model: "m", inputTokens: 100, outputTokens: 20, cachedInputTokens: 0 };
const good = (files: string[]) => ({
  concepts: ["alpha idea", "beta idea", "gamma idea"].map((name) => ({
    name,
    reason: "because",
    basis: ["readme", ...files.slice(0, 1)],
  })),
});
const run = (generate: Generate, backend: "api" | "claude-code", logCost: () => number | null, only = repos) => {
  const subject = createConceptMapperSubject({ generate, backend, logCost, coreFilesOf: () => ["a.ts"] });
  return runEval({ step: "concepts", subject, repos: only, loadFixture });
};
const okGen: Generate = async ({ schema }) => ({ value: schema.parse(good(["a.ts"])), usage }) as never;

describe("concept-mapper subject", () => {
  test("api: usd and tokens per call, means per call", async () => {
    const r = await run(okGen, "api", () => 0.01);
    expect(r.rows[0]).toMatchObject({ modelCalls: 1, usd: 0.01, tokens: 120 });
    expect(r.mean).toMatchObject({ tokensPerCall: 120, usdPerCall: 0.01 });
    expect(renderMarkdown(r)).toContain("| Model calls | Tokens | USD |");
  });

  test("claude-code: usd is null, never 0; tokens still counted", async () => {
    const r = await run(okGen, "claude-code", () => null);
    expect(r.rows[0]?.usd).toBeNull();
    expect(r.mean.usdPerCall).toBeNull();
    expect(r.mean.tokensPerCall).toBe(120);
    expect(renderMarkdown(r)).toContain("n/a");
  });

  test("one failed repo does not null the others' price", async () => {
    let n = 0;
    const gen: Generate = async (i) => {
      if (n++ === 0) throw new Error("boom");
      return okGen(i);
    };
    const r = await run(gen, "api", () => 0.01);
    expect(r.rows[0]?.error).toBe("boom");
    expect(r.rows[0]?.usd).toBeNull();
    expect(r.rows[1]?.usd).toBe(0.01);
    expect(r.mean.usdPerCall).toBe(0.01);
  });

  test("no call anywhere: null means", async () => {
    const gen: Generate = async () => {
      throw new Error("down");
    };
    const r = await run(gen, "api", () => 0.01);
    expect(r.mean).toMatchObject({ tokensPerCall: null, usdPerCall: null });
  });

  test("invalid output twice still counts both calls", async () => {
    const gen: Generate = async () =>
      ({
        value: {
          concepts: [
            { name: "x y", reason: "r", basis: ["nope"] },
            { name: "p q", reason: "r", basis: ["nope"] },
            { name: "s t", reason: "r", basis: ["nope"] },
          ],
        },
        usage,
      }) as never;
    const r = await run(gen, "api", () => 0.01, repos.slice(0, 1));
    expect(r.rows[0]).toMatchObject({ modelCalls: 2, usd: 0.02, tokens: 240 });
    expect(r.rows[0]?.error).toContain("mapper-invalid-output");
  });
});
