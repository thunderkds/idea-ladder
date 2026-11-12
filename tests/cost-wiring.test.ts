// T006 AC 6 / AC 9: the server's reader cost logger (main.ts) maps each reader call to logStepCost.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UnknownModelPriceError } from "../eval/src/cost.ts";
import { readerCostLogger } from "../src/server/cost-wiring.ts";

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});
const entry = {
  jobId: "42",
  repo: "acme/demo",
  sha: "a".repeat(40),
  step: "pick-core-files",
  model: "claude-unpriced-9",
  inputTokens: 100,
  outputTokens: 50,
  cachedInputTokens: 1200,
};

describe("readerCostLogger", () => {
  test("claude-code with an unpriced model id logs usd: null and does not throw", async () => {
    const logDir = await mkdtemp(join(tmpdir(), "il-cost-"));
    dirs.push(logDir);
    readerCostLogger({ logDir, prices: {} })({ ...entry, backend: "claude-code" });
    const [line] = (await readFile(join(logDir, "job-42.jsonl"), "utf8")).trim().split("\n");
    expect(JSON.parse(line as string)).toMatchObject({
      runId: "job-42",
      ladderKey: `acme/demo@${"a".repeat(40)}`,
      step: "pick-core-files",
      model: "claude-unpriced-9",
      inputTokens: 100,
      outputTokens: 50,
      cachedInputTokens: 1200,
      usd: null,
    });
  });

  test("api with an unpriced model id still throws", async () => {
    const logDir = await mkdtemp(join(tmpdir(), "il-cost-"));
    dirs.push(logDir);
    expect(() => readerCostLogger({ logDir, prices: {} })({ ...entry, backend: "api" })).toThrow(
      UnknownModelPriceError,
    );
  });
});
