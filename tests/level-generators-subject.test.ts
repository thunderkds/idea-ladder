// T008 (8d) Success Criterion 8 (offline part): the level-generators eval subject and its threshold summary, on mocks.
import { describe, expect, test } from "bun:test";
import { loadFixture } from "../eval/src/golden.ts";
import {
  createLevelGeneratorsSubject,
  type LadderRow,
  summarizeLadders,
} from "../eval/src/level-generators-subject.ts";
import type { LevelReport } from "../src/server/save-ladder.ts";
import { mockEmbedder } from "./support/mock-embedder.ts";
import { testModelA } from "./support/mock-model.ts";

const totals = (usd: number | null, tokens = 10) => ({
  calls: 1,
  inputTokens: tokens,
  outputTokens: 0,
  cachedInputTokens: 0,
  usd,
});
const level = (id: LevelReport["level"], over: Partial<LevelReport> = {}): LevelReport => ({
  level: id,
  status: "generated",
  generated: { cards: 5, mcqs: 0 },
  kept: { cards: 5, mcqs: 0 },
  dropped: {},
  flags: [],
  ...over,
});
const row = (
  fullName: string,
  l3Kept: number,
  keyDrops: number,
  opts: { fallback?: boolean; usd?: number | null } = {},
) =>
  ({
    fullName,
    fallback: opts.fallback ?? false,
    report: {
      levels: [
        level("L0", { generated: { cards: 5, mcqs: 10 }, kept: { cards: 5, mcqs: 10 } }),
        level("L3", {
          generated: { cards: 5, mcqs: l3Kept + keyDrops },
          kept: { cards: 5, mcqs: l3Kept },
          dropped: keyDrops ? { "key-check-failed": keyDrops } : {},
        }),
      ],
      costByStep: { "generate-level-L3": totals(opts.usd === undefined ? 0.5 : opts.usd, 100) },
    },
  }) satisfies LadderRow;

describe("level-generators summary (pre-registered thresholds)", () => {
  test("L3 pool share over non-fallback repos, key-check drop share over generated MCQs, mean cost per ladder", () => {
    const s = summarizeLadders([
      row("a/a", 9, 1),
      row("b/b", 8, 0),
      row("c/c", 7, 5),
      row("d/d", 15, 0),
      row("e/e", 0, 0, { fallback: true }), // not counted in the L3 share
    ]);
    expect(s.l3Pool).toEqual({ ok: 3, of: 4, share: 0.75 });
    // MCQs generated: L0 10 x 5 + L3 (10 + 8 + 12 + 15 + 0) = 95; key-check-failed 6
    expect(s.keyCheckDrops).toEqual({ dropped: 6, generatedMcqs: 95, share: 6 / 95 });
    expect(s.meanUsdPerLadder).toBeCloseTo(0.5);
    expect(s.meanTokensPerLadder).toBe(100);
    expect(s.verdicts).toEqual([
      "MISS: L3 pool >= 8 MCQs on 3/4 non-fallback repos (75.0%; keep if >= 80.0%)",
      "PASS: key-check-failed drops 6/95 generated MCQs (6.3%; keep if <= 25.0%)",
      "REPORTED: mean cost per ladder $0.5000, mean tokens 100 (T017 sets the cap)",
    ]);
  });

  test("a claude-code run (usd null) reports the cost as n/a, never $0; no rows -> NO DATA", () => {
    const s = summarizeLadders([row("a/a", 8, 0), row("b/b", 8, 20, { usd: null })]);
    expect(s.meanUsdPerLadder).toBeNull();
    expect(s.verdicts[1]).toStartWith("MISS: key-check-failed drops 20/56");
    expect(s.verdicts[2]).toBe(
      "REPORTED: mean cost per ladder n/a (usd null: claude-code back end), mean tokens 100 (T017 sets the cap)",
    );
    expect(
      summarizeLadders([])
        .verdicts.slice(0, 2)
        .map((v) => v.split(":")[0]),
    ).toEqual(["NO DATA", "NO DATA"]);
  });
});

describe("level-generators subject on mocks", () => {
  test("developit/mitt: five levels generated, checked and reported; cost per step from the logged calls", async () => {
    const fx = loadFixture("developit/mitt");
    const logged: string[] = [];
    const subject = createLevelGeneratorsSubject({
      generate: testModelA().generate,
      embedder: mockEmbedder(),
      readFile: async (_fx, path) => Array.from({ length: 80 }, (_, i) => `${path} line ${i + 1}`).join("\n"),
      coreFilesOf: () => ["src/index.ts"],
      conceptsOf: () => ["event emitter", "typescript generics", "map"],
      logCost: (_fx, step) => {
        logged.push(step);
        return 0.01;
      },
    });
    const { fullName, fallback, report } = await subject.ladder(fx);
    expect(fullName).toBe("developit/mitt");
    expect(fallback).toBe(false);
    expect(report.levels.map((l) => `${l.level} ${l.status}`)).toEqual(
      ["L0", "L1", "L2", "L3", "L4"].map((l) => `${l} generated`),
    );
    // testModelA answers the same card and question at every level: L0 keeps them, the rest are duplicates.
    expect(report.levels[0]).toMatchObject({
      kept: { cards: 1, mcqs: 1 },
      flags: ["insufficient-pool", "insufficient-cards"],
    });
    expect(report.levels[1]?.dropped).toEqual({ duplicate: 2 });
    const steps = Object.keys(report.costByStep ?? {}).sort();
    expect(steps).toEqual(
      [
        "check-and-dedupe",
        "chunk-and-embed",
        ...["L0", "L1", "L2", "L3", "L4"].map((l) => `generate-level-${l}`),
      ].sort(),
    );
    expect(Object.values(report.costByStep ?? {}).reduce((n, t) => n + t.calls, 0)).toBe(logged.length);
  });
});
