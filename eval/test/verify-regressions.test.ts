import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { logStepCost, UnknownModelPriceError } from "../src/cost.js";
import { renderMarkdown, type Report } from "../src/harness.js";

describe("logStepCost with inherited object keys", () => {
  it.each(["constructor", "__proto__", "toString"])("throws for model %s and writes nothing", async (model) => {
    const logDir = await mkdtemp(join(tmpdir(), "cost-"));
    const prices = { "test-model": { input: 3, output: 15, cachedInput: 0.3, source: "test", checkedAt: "2026-11-01" } };
    await expect(
      logStepCost({ runId: "r", ladderKey: "a/b", step: "s", model, inputTokens: 1, outputTokens: 1 }, { prices, logDir }),
    ).rejects.toBeInstanceOf(UnknownModelPriceError);
    expect(await readdir(logDir)).toEqual([]);
  });
});

describe("renderMarkdown", () => {
  it.each(["core-files", "concepts"] as const)("%s table: header and separator have the same cell count", (step) => {
    const report: Report = { step, subject: "s", generatedAt: "2026-11-01T00:00:00.000Z", repoCount: 0, rows: [], mean: {} };
    const lines = renderMarkdown(report).split("\n");
    const header = lines.findIndex((l) => l.startsWith("| Repo"));
    const cells = (l: string | undefined) => (l ?? "").split("|").length;
    expect(cells(lines[header + 1])).toBe(cells(lines[header]));
  });
});
