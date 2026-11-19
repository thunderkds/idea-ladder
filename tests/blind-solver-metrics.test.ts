// T009 AC 5-7 and Success Criterion 6: the measurement arithmetic with scripted model B answers. No model call.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Choice,
  changedAnswers,
  loadSeed,
  measure,
  missingCredentials,
  renderReport,
  type SeedItem,
  verdictLines,
} from "../eval/src/blind-solver-measure.ts";

const src = { repo: "o/r", path: "README.md", sha: "0".repeat(40) };
const item = (id: string, kind: SeedItem["kind"], chunk: string, options: string[]): SeedItem => ({
  id,
  kind,
  question: `q ${id}`,
  options,
  key: options[0] as string,
  chunk,
  source: src,
});
// 4 hand-made MCQs. The key is always the first option.
const items = [
  item("i1", "span", "alpha beta gamma delta", ["alpha", "zeta", "eta", "theta"]), // no distractor in the chunk
  item("i2", "span", "red green blue", ["red", "green", "cyan", "pink"]), // distractor `green` in the chunk
  item("i3", "paraphrase", "uses a cache", ["it caches", "it logs", "it sorts", "it hashes"]), // code check rejects the key
  item("i4", "span", "one two three", ["one", "two", "four", "five"]), // model B picks the wrong option
];
const picks: Choice[] = [
  { id: "i1", picked: "alpha", seed: 1 },
  { id: "i2", picked: "red", seed: 2 },
  { id: "i3", picked: "it caches", seed: 3 },
  { id: "i4", picked: "two", seed: 4 },
];

describe("measure (SC 6)", () => {
  const m = measure(items, picks);

  test("(a) code check alone: exact counts", () => {
    expect(m.code).toMatchObject({ wrongTotal: 12, caught: 10, correctTotal: 4, falseRejects: 1 });
    expect(m.code.misses).toEqual([
      { id: "i2", key: "green" },
      { id: "i4", key: "two" },
    ]);
    expect(m.code.falseRejectList).toEqual([{ id: "i3", key: "it caches" }]);
    expect(m.code.catchRate).toBeCloseTo(10 / 12);
    expect(m.code.falseRejectRate).toBe(0.25);
  });

  test("(b) blind solver alone: exact counts", () => {
    expect(m.blind).toMatchObject({ wrongTotal: 12, caught: 11, correctTotal: 4, falseRejects: 1 });
    expect(m.blind.misses).toEqual([{ id: "i4", key: "two" }]);
    expect(m.blind.falseRejectList).toEqual([{ id: "i4", key: "one" }]);
  });

  test("(c) both: kept only if both pass", () => {
    expect(m.both).toMatchObject({ wrongTotal: 12, caught: 11, correctTotal: 4, falseRejects: 2 });
    expect(m.both.misses).toEqual([{ id: "i4", key: "two" }]);
    expect(m.both.falseRejectList.map((x) => x.id)).toEqual(["i3", "i4"]);
    expect(m.both.falseRejectRate).toBe(0.5);
  });

  test("per item kind", () => {
    expect(m.code.byKind.span).toEqual({ wrongTotal: 9, caught: 7, correctTotal: 3, falseRejects: 0 });
    expect(m.code.byKind.paraphrase).toEqual({ wrongTotal: 3, caught: 3, correctTotal: 1, falseRejects: 1 });
    expect(m.both.byKind.paraphrase).toEqual({ wrongTotal: 3, caught: 3, correctTotal: 1, falseRejects: 1 });
  });

  test("a failed model B call (picked null) is a disagreement: false reject, never agreement", () => {
    const failed = measure(items, [{ id: "i1", picked: null, seed: null, failure: "boom" }, ...picks.slice(1)]);
    expect(failed.blind.falseRejectList.map((x) => x.id)).toEqual(["i1", "i4"]);
    expect(failed.blind.misses).toEqual([{ id: "i4", key: "two" }]);
    const missing = measure(items, []); // no answer at all: nothing is ever kept by (b) or (c)
    expect(missing.blind.falseRejects).toBe(4);
    expect(missing.blind.caught).toBe(12);
  });
});

describe("verdictLines (pre-registered thresholds)", () => {
  test("KEEP only when both thresholds hold; one line per decision", () => {
    const lines = verdictLines(measure(items, picks));
    expect(lines[0]).toMatch(/^VERDICT code check \+ blind solver: FAIL \(catch 91\.7%, false-reject 50\.0%/);
    expect(lines[0]).toContain("entailment-check alternative");
    expect(lines[1]).toBe("VERDICT blind solver alone: MISSES both thresholds (catch 91.7%, false-reject 25.0%)");
    expect(lines[2]).toMatch(/^VERDICT code check alone: MISSES/);
  });

  test("a policy at exactly catch 90% and false-reject 10% keeps; the decision input line appears when only (b) meets", () => {
    const ok = {
      wrongTotal: 0,
      caught: 0,
      correctTotal: 0,
      falseRejects: 0,
      byKind: {},
      misses: [],
      falseRejectList: [],
    };
    const keep = { ...ok, catchRate: 0.9, falseRejectRate: 0.1 };
    const bad = { ...ok, catchRate: 0.89, falseRejectRate: 0.1 };
    expect(verdictLines({ code: bad, blind: keep, both: keep })[0]).toMatch(/KEEP/);
    const lines = verdictLines({ code: bad, blind: keep, both: bad });
    expect(lines[0]).toMatch(/FAIL/);
    expect(lines.at(-1)).toMatch(/^DECISION INPUT: the blind solver alone meets both thresholds/);
  });
});

describe("report and run guards (AC 5, 6, 7)", () => {
  const usage = { model: "m-b", inputTokens: 100, outputTokens: 10, cachedInputTokens: 5 };
  const facts = {
    timestamp: "2026-11-19T00:00:00.000Z",
    backend: "claude-code" as const,
    models: ["m-b"],
    seedSha256: "abc",
    items,
    choices: picks,
    usages: [usage, usage, usage, usage],
  };

  test("the report has 3 policies, the per-kind table, calls and tokens per 100 questions, and verdict lines", () => {
    const md = renderReport(facts);
    for (const t of ["(a) code check alone", "(b) blind solver alone", "(c) both", "By item kind", "| paraphrase |"])
      expect(md).toContain(t);
    expect(md).toContain("Model B calls: 4 for 4 questions = 100.0 per 100 questions");
    expect(md).toContain("input 10000.0");
    expect(md).toContain("VERDICT code check + blind solver:");
    expect(md).toContain("no temperature flag");
    expect(md).toContain("Same-provider blind spots");
    expect(md).toContain("upper bound");
  });

  test("temperature 0 is stated for the api back end; a second run lists the items whose answer changed", () => {
    expect(renderReport({ ...facts, backend: "api" })).toContain("temperature 0");
    const changed = changedAnswers(picks, [{ id: "i1", picked: "zeta", seed: 1 }, ...picks.slice(1)]);
    expect(changed).toEqual([{ id: "i1", before: "alpha", after: "zeta" }]);
    expect(changedAnswers(picks, picks)).toEqual([]);
    const md = renderReport({ ...facts, previous: { file: "blind-solver-x.json", changed } });
    expect(md).toContain("1 item(s) changed their answer: i1 (alpha -> zeta)");
  });

  test("the seed loader refuses a hash mismatch and makes no call", () => {
    const dir = mkdtempSync(join(tmpdir(), "seed-"));
    writeFileSync(join(dir, "blind-solver-seed.json"), "[]\n");
    writeFileSync(join(dir, "blind-solver-seed.sha256"), `${"0".repeat(64)}  blind-solver-seed.json\n`);
    expect(() => loadSeed(dir)).toThrow(/seed set hash mismatch/);
    expect(loadSeed().items.length).toBeGreaterThanOrEqual(40); // the real seed set matches its lock
  });

  test("without credentials it names what is missing", async () => {
    expect(await missingCredentials({ MODEL_B_BACKEND: "api" })).toEqual([
      "ANTHROPIC_API_KEY (MODEL_B_BACKEND=api)",
      "MODEL_B_ID (MODEL_B_BACKEND=api)",
    ]);
    expect(await missingCredentials({}, () => null)).toEqual([
      expect.stringContaining("`claude` CLI is not installed"),
    ]);
    expect(await missingCredentials({ MODEL_B_BACKEND: "openai" })).toEqual([
      expect.stringContaining("MODEL_B_BACKEND"),
    ]);
  });
});
