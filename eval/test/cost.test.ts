import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  InvalidCostEntryError,
  UnknownModelPriceError,
  loadPrices,
  logStepCost,
  readCostLog,
  summarizeRun,
} from "../src/cost.ts";

const prices = { "test-model": { input: 3, output: 15, cachedInput: 0.3 } };
let logDir: string;
beforeEach(() => { logDir = mkdtempSync(join(tmpdir(), "cost-")); });
afterEach(() => { rmSync(logDir, { recursive: true, force: true }); });

const base = { runId: "run-1", ladderKey: "o/r", step: "mapper", model: "test-model", inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };

describe("logStepCost (AC 6)", () => {
  test("1,000,000 input + 100,000 output at 3 / 15 USD per 1M = 4.5 USD", () => {
    const line = logStepCost({ ...base, inputTokens: 1_000_000, outputTokens: 100_000 }, { prices, logDir });
    expect(line.usd).toBe(4.5);
  });

  test("appends one JSON line per call to <logDir>/<runId>.jsonl", () => {
    logStepCost({ ...base, inputTokens: 10 }, { prices, logDir });
    logStepCost({ ...base, step: "gen-l1", outputTokens: 20 }, { prices, logDir });
    const lines = readFileSync(join(logDir, "run-1.jsonl"), "utf8").trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]!);
    expect(first).toMatchObject({ runId: "run-1", ladderKey: "o/r", step: "mapper", model: "test-model", inputTokens: 10 });
    expect(typeof first.ts).toBe("string");
  });

  test("cached input tokens are priced separately at the cachedInput rate", () => {
    const line = logStepCost({ ...base, inputTokens: 1_000_000, cachedInputTokens: 1_000_000 }, { prices, logDir });
    expect(line.usd).toBe(3.3); // 3.0 fresh + 0.3 cached
  });

  test("0 tokens with a known model logs usd 0", () => {
    expect(logStepCost(base, { prices, logDir }).usd).toBe(0);
  });

  test("cachedInputTokens is optional and defaults to 0", () => {
    const { cachedInputTokens: _omit, ...noCached } = base;
    const line = logStepCost({ ...noCached, inputTokens: 1_000_000 }, { prices, logDir });
    expect(line.cachedInputTokens).toBe(0);
    expect(line.usd).toBe(3);
  });
});

describe("logStepCost negatives (AC 7)", () => {
  test("unknown model throws UnknownModelPriceError and writes nothing", () => {
    expect(() => logStepCost({ ...base, model: "not-in-table", inputTokens: 5 }, { prices, logDir })).toThrow(UnknownModelPriceError);
    expect(() => readFileSync(join(logDir, "run-1.jsonl"))).toThrow();
  });

  test("a model name that is an Object.prototype key ('constructor') is unknown, not a price", () => {
    expect(() => logStepCost({ ...base, model: "constructor" }, { prices, logDir })).toThrow(UnknownModelPriceError);
    expect(() => logStepCost({ ...base, model: "__proto__" }, { prices, logDir })).toThrow(UnknownModelPriceError);
  });

  test("the error names the model", () => {
    try {
      logStepCost({ ...base, model: "not-in-table" }, { prices, logDir });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(UnknownModelPriceError);
      expect((e as Error).message).toContain("not-in-table");
    }
  });

  test("negative token counts are rejected", () => {
    expect(() => logStepCost({ ...base, inputTokens: -1 }, { prices, logDir })).toThrow(InvalidCostEntryError);
    expect(() => logStepCost({ ...base, outputTokens: -5 }, { prices, logDir })).toThrow(InvalidCostEntryError);
    expect(() => logStepCost({ ...base, cachedInputTokens: -1 }, { prices, logDir })).toThrow(InvalidCostEntryError);
  });

  test("fractional and non-finite token counts are rejected", () => {
    expect(() => logStepCost({ ...base, inputTokens: 1.5 }, { prices, logDir })).toThrow(InvalidCostEntryError);
    expect(() => logStepCost({ ...base, inputTokens: Number.NaN }, { prices, logDir })).toThrow(InvalidCostEntryError);
  });

  test("missing or empty step is rejected", () => {
    const { step: _s, ...noStep } = base;
    expect(() => logStepCost(noStep as never, { prices, logDir })).toThrow(InvalidCostEntryError);
    expect(() => logStepCost({ ...base, step: "" }, { prices, logDir })).toThrow(InvalidCostEntryError);
  });

  test("runId that could escape the log directory is rejected", () => {
    expect(() => logStepCost({ ...base, runId: "../evil" }, { prices, logDir })).toThrow(InvalidCostEntryError);
    expect(() => logStepCost({ ...base, runId: "a/b" }, { prices, logDir })).toThrow(InvalidCostEntryError);
  });
});

describe("price table", () => {
  test("shipped prices.json: every entry has numeric rates, a source and a checkedAt; test-model is present", () => {
    const p = loadPrices();
    expect(p["test-model"]).toBeDefined();
    for (const [model, entry] of Object.entries(p)) {
      expect(entry.source.length, model).toBeGreaterThan(0);
      expect(entry.checkedAt, model).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.input).toBeGreaterThanOrEqual(0);
    }
  });

  test("a prices file with a missing source is rejected", () => {
    const bad = join(logDir, "bad-prices.json");
    writeFileSync(bad, JSON.stringify({ m: { input: 1, output: 1, cachedInput: 0.1, checkedAt: "2026-11-12" } }));
    expect(() => loadPrices(bad)).toThrow();
  });
});

describe("summarizeRun / eval:cost (AC 6)", () => {
  test("totals per step and per ladder", () => {
    logStepCost({ ...base, ladderKey: "a/x", step: "mapper", inputTokens: 1_000_000 }, { prices, logDir });
    logStepCost({ ...base, ladderKey: "a/x", step: "gen", outputTokens: 1_000_000 }, { prices, logDir });
    logStepCost({ ...base, ladderKey: "b/y", step: "mapper", inputTokens: 2_000_000 }, { prices, logDir });
    const s = summarizeRun(readCostLog("run-1", logDir));
    expect(s.byStep).toEqual({ mapper: { calls: 2, inputTokens: 3_000_000, outputTokens: 0, cachedInputTokens: 0, usd: 9 }, gen: { calls: 1, inputTokens: 0, outputTokens: 1_000_000, cachedInputTokens: 0, usd: 15 } });
    expect(s.byLadder["a/x"]?.usd).toBe(18);
    expect(s.byLadder["b/y"]?.usd).toBe(6);
    expect(s.totalUsd).toBe(24);
  });

  test("a missing run log throws a clear error", () => {
    expect(() => readCostLog("no-such-run", logDir)).toThrow(/no-such-run/);
  });

  test("a corrupt log line is reported with its line number, not skipped", () => {
    writeFileSync(join(logDir, "bad.jsonl"), '{"not":"a cost line"}\n');
    expect(() => readCostLog("bad", logDir)).toThrow(/line 1/);
  });

  test("the committed test-fixture-run log reads and sums", () => {
    const s = summarizeRun(readCostLog("test-fixture-run"));
    expect(s.totalUsd).toBeGreaterThan(0);
    expect(Object.keys(s.byStep).length).toBeGreaterThanOrEqual(2);
    expect(Object.keys(s.byLadder).length).toBeGreaterThanOrEqual(2);
  });
});
