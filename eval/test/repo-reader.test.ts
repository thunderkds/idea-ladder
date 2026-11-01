import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vitest";
import type { Report } from "../src/harness.js";
import { runEval } from "../src/harness.js";
import { loadSnapshot } from "../src/fixtures.js";
import { createRepoReaderSubject, rawFileReader, summarizeReader, THRESHOLDS, type RunStat } from "../src/subjects/repo-reader.js";

const report = (recall: number[]): Report => ({
  step: "core-files", subject: "x", generatedAt: "t", repoCount: recall.length,
  rows: recall.map((r, i) => ({ fullName: `o/r${i}`, tier: "t", recall: r, precision: 0.5, missed: [], extra: [] })),
  mean: { recall: recall.reduce((a, b) => a + b, 0) / recall.length, precision: 0.5 },
});
const stat = (i: number, stoppedBy: RunStat["stoppedBy"] = "model"): RunStat => ({ fullName: `o/r${i}`, steps: 4, toolCalls: 3, modelCalls: 4, totalTokens: 10_000, usd: 0.05, stoppedBy });

describe("summarizeReader verdicts (pre-registered thresholds)", () => {
  it("keeps the reader at recall >= 0.60 and >= baseline + 0.10, with <= 4 capped runs", () => {
    const md = summarizeReader(report([0.7, 0.7]), report([0.5, 0.5]), [stat(0), stat(1)]);
    expect(md).toContain("VERDICT recall: KEEP own reader");
    expect(md).toContain("VERDICT step cap / budget: within limit — 0 of 2 runs");
    expect(md).toContain("Mean steps 4.00");
    expect(md).toContain("mean cost USD 0.0500");
  });
  it("records 'below threshold' when recall is under 0.60 or under baseline + 0.10", () => {
    expect(summarizeReader(report([0.55]), report([0.1]), [stat(0)])).toContain("own reader below threshold");
    expect(summarizeReader(report([0.7]), report([0.65]), [stat(0)])).toContain("own reader below threshold");
    expect(THRESHOLDS).toEqual({ minRecall: 0.6, minRecallOverBaseline: 0.1, maxCapOrBudgetRuns: 4 });
  });
  it("flags more than 4 capped runs", () => {
    const stats = [0, 1, 2, 3, 4].map((i) => stat(i, i % 2 ? "step-cap" : "budget"));
    expect(summarizeReader(report([0.9, 0.9, 0.9, 0.9, 0.9]), report([0, 0, 0, 0, 0]), stats)).toContain("over limit — 5 of 5");
  });
});

const finalAnswerOnly = (picks: string[]) =>
  new MockLanguageModelV3({
    modelId: "test-model",
    doGenerate: async () => ({
      content: [{ type: "text" as const, text: JSON.stringify({ coreFiles: picks.map((path) => ({ path, reason: "r" })) }) }],
      finishReason: { unified: "stop" as const, raw: "end_turn" },
      usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
      warnings: [],
    }),
  });

describe("repo-reader subject (offline: mock model, replayed fixture tree, stubbed raw file fetch)", () => {
  it("runs through the harness on a golden fixture, logs cost under step pick-core-files, and reads only at the pinned SHA", async () => {
    const snap = await loadSnapshot("lukeed/dset");
    const picks = snap.tree.filter((p) => /\.(js|json)$/.test(p)).slice(0, 3);
    expect(picks.length).toBe(3);
    const urls: string[] = [];
    const fetchImpl = (async (u: string | URL | Request) => { urls.push(String(u)); return new Response("export const a = 1;\n"); }) as typeof fetch;
    let n = 0;
    const model = new MockLanguageModelV3({
      modelId: "test-model",
      doGenerate: async () => {
        const call = n++;
        const usage = { inputTokens: { total: 1000, noCache: 1000, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 100, text: 100, reasoning: 0 } };
        if (call === 0) return { content: [{ type: "tool-call" as const, toolCallId: "c1", toolName: "read", input: JSON.stringify({ path: picks[0] }) }], finishReason: { unified: "tool-calls" as const, raw: "tool_use" }, usage, warnings: [] };
        return { content: [{ type: "text" as const, text: JSON.stringify({ coreFiles: picks.map((path) => ({ path, reason: "r" })) }) }], finishReason: { unified: "stop" as const, raw: "end_turn" }, usage, warnings: [] };
      },
    });
    // prices.json has "test-model"; the default log dir is eval/cost-log (git-ignored), read back through the run id
    const runId = `t006-offline-${randomUUID()}`;
    const subject = createRepoReaderSubject({ model, fetchImpl, runId, limits: { maxSteps: 15, tokenBudget: 80_000 } });
    const entry = { fullName: "lukeed/dset", tier: "small", expectedCoreFiles: picks, expectedConcepts: [] } as never;
    const out = await subject.run(snap, entry);
    expect(out.coreFiles).toEqual(picks);
    expect(urls).toEqual([`https://raw.githubusercontent.com/lukeed/dset/${snap.sha}/${picks[0]}`]);
    expect(subject.stats).toHaveLength(1);
    expect(subject.stats[0]).toMatchObject({ fullName: "lukeed/dset", steps: 2, toolCalls: 1, modelCalls: 2, totalTokens: 2200, stoppedBy: "model" });
    expect(subject.stats[0]!.usd).toBeGreaterThan(0);
    const log = (await readFile(new URL(`../cost-log/${runId}.jsonl`, import.meta.url), "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ step: "pick-core-files", model: "test-model", inputTokens: 1000, outputTokens: 100 });
    const rep = await runEval({
      step: "core-files", subjectName: "repo-reader", repos: [entry], loadSnapshot: async () => snap,
      subject: createRepoReaderSubject({ model: finalAnswerOnly(picks), fetchImpl, runId: `t006-offline-${randomUUID()}`, limits: { maxSteps: 15, tokenBudget: 80_000 } }),
    });
    expect(rep.mean.recall).toBe(1);
  });

  it("rawFileReader refuses a failing read instead of returning an empty file", async () => {
    const read = rawFileReader("o/r", "a".repeat(40), (async () => new Response("", { status: 404 })) as typeof fetch);
    await expect(read("x.ts")).rejects.toThrow(/404/);
  });
});
