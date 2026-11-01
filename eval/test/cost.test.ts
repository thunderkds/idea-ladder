import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { InvalidCostInputError, logStepCost, summarizeCost, UnknownModelPriceError, readCostLog } from "../src/cost.js";

const prices = { "test-model": { input: 3, output: 15, cachedInput: 0.3, source: "test", checkedAt: "2026-11-01" } };
const base = { runId: "r1", ladderKey: "owner/name", step: "mapper", model: "test-model", inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
const mk = async () => ({ prices, logDir: await mkdtemp(join(tmpdir(), "cost-")), now: () => new Date("2026-11-01T00:00:00Z") });

describe("logStepCost (AC 6, 7)", () => {
  it("1,000,000 input + 100,000 output at 3/15 USD per 1M = 4.5", async () => {
    const o = await mk();
    const rec = await logStepCost({ ...base, inputTokens: 1_000_000, outputTokens: 100_000 }, o);
    expect(rec.usd).toBe(4.5);
    const lines = (await readFile(join(o.logDir, "r1.jsonl"), "utf8")).trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ runId: "r1", step: "mapper", usd: 4.5, ts: "2026-11-01T00:00:00.000Z" });
  });
  it("prices cached input separately", async () => {
    const o = await mk();
    const rec = await logStepCost({ ...base, cachedInputTokens: 1_000_000 }, o);
    expect(rec.usd).toBe(0.3);
  });
  it("appends one line per call", async () => {
    const o = await mk();
    await logStepCost({ ...base, inputTokens: 1 }, o);
    await logStepCost({ ...base, inputTokens: 2 }, o);
    expect(await readCostLog("r1", o.logDir)).toHaveLength(2);
  });
  it("0 tokens with a known model logs usd 0", async () => {
    const o = await mk();
    expect((await logStepCost(base, o)).usd).toBe(0);
  });
  it("unknown model throws UnknownModelPriceError and writes nothing", async () => {
    const o = await mk();
    await expect(logStepCost({ ...base, model: "not-in-table", inputTokens: 5 }, o)).rejects.toBeInstanceOf(UnknownModelPriceError);
    await expect(readCostLog("r1", o.logDir)).resolves.toEqual([]);
  });
  it.each([
    ["negative input", { inputTokens: -1 }],
    ["negative output", { outputTokens: -1 }],
    ["negative cached", { cachedInputTokens: -1 }],
    ["fractional tokens", { inputTokens: 1.5 }],
    ["missing step", { step: "" }],
    ["missing runId", { runId: "" }],
    ["path-like runId", { runId: "../x" }],
  ])("rejects %s", async (_n, patch) => {
    const o = await mk();
    await expect(logStepCost({ ...base, ...patch }, o)).rejects.toBeInstanceOf(InvalidCostInputError);
  });
  it("summarizeCost groups per step and per ladder", () => {
    const rec = (ladderKey: string, step: string, usd: number) => ({ ts: "t", runId: "r1", ladderKey, step, model: "m", inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, usd });
    const s = summarizeCost([rec("a/a", "mapper", 1), rec("a/a", "level", 2), rec("b/b", "mapper", 4)]);
    expect(s.perStep).toEqual({ mapper: 5, level: 2 });
    expect(s.perLadder).toEqual({ "a/a": 3, "b/b": 4 });
    expect(s.totalUsd).toBe(7);
  });
});
