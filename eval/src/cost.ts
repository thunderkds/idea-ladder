import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CostLineSchema, PriceTableSchema, type CostLine, type PriceTable } from "./schema.ts";

export const COST_LOG_DIR = join(import.meta.dir, "..", "cost-log");
export const PRICES_PATH = join(import.meta.dir, "..", "prices.json");

export class UnknownModelPriceError extends Error {
  constructor(public readonly model: string) {
    super(`no price for model "${model}" in the price table; refusing to log usd: 0`);
    this.name = "UnknownModelPriceError";
  }
}

export class InvalidCostEntryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCostEntryError";
  }
}

export interface StepCostInput {
  runId: string;
  ladderKey: string;
  step: string;
  model: string;
  /** Fresh (non-cached) input tokens. Cached input tokens are counted separately and priced at `cachedInput`. */
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  /** Model A back end. `claude-code` (the subscription) logs `usd: null`; anything else is priced. Default `api`. */
  backend?: "api" | "claude-code";
}

export interface LogOptions {
  /** Price table (USD per 1M tokens). Defaults to `prices.json`. */
  prices?: Record<string, { input: number; output: number; cachedInput: number }>;
  logDir?: string;
  now?: () => Date;
}

export function loadPrices(path = PRICES_PATH): PriceTable {
  return PriceTableSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

const RUN_ID_RE = /^[A-Za-z0-9._-]+$/;
const token = (v: unknown, name: string) => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
    throw new InvalidCostEntryError(`${name} must be a non-negative integer, got ${String(v)}`);
  }
  return v;
};
const text = (v: unknown, name: string) => {
  if (typeof v !== "string" || v.length === 0) throw new InvalidCostEntryError(`${name} is required`);
  return v;
};
/** 1e-10 rounding hides float noise (3 + 0.3) without changing real cents. */
const round = (n: number) => Math.round(n * 1e10) / 1e10;

/**
 * Appends one JSON line to `<logDir>/<runId>.jsonl` and returns it. `usd` is computed from the price table,
 * or null for `backend: "claude-code"` (subscription: no per-call price, no price-table lookup).
 * Throws `UnknownModelPriceError` for a model with no price (never logs `usd: 0`) and
 * `InvalidCostEntryError` for a missing step / run / ladder, a bad runId or a bad token count. Nothing is written on error.
 */
export function logStepCost(input: StepCostInput, opts: LogOptions = {}): CostLine {
  const runId = text(input.runId, "runId");
  if (!RUN_ID_RE.test(runId)) throw new InvalidCostEntryError(`runId must match ${RUN_ID_RE}, got ${runId}`);
  const ladderKey = text(input.ladderKey, "ladderKey");
  const step = text(input.step, "step");
  const model = text(input.model, "model");
  const inputTokens = token(input.inputTokens, "inputTokens");
  const outputTokens = token(input.outputTokens, "outputTokens");
  const cachedInputTokens = token(input.cachedInputTokens ?? 0, "cachedInputTokens");

  let usd: number | null = null;
  if (input.backend !== "claude-code") {
    const prices = opts.prices ?? loadPrices();
    const price = Object.hasOwn(prices, model) ? prices[model] : undefined;
    if (!price) throw new UnknownModelPriceError(model);
    usd = round((inputTokens * price.input + outputTokens * price.output + cachedInputTokens * price.cachedInput) / 1_000_000);
  }
  const line: CostLine = {
    ts: (opts.now?.() ?? new Date()).toISOString(),
    runId, ladderKey, step, model, inputTokens, outputTokens, cachedInputTokens, usd,
  };
  const dir = opts.logDir ?? COST_LOG_DIR;
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, `${runId}.jsonl`), `${JSON.stringify(line)}\n`);
  return line;
}

export function readCostLog(runId: string, logDir = COST_LOG_DIR): CostLine[] {
  if (!RUN_ID_RE.test(runId)) throw new InvalidCostEntryError(`runId must match ${RUN_ID_RE}, got ${runId}`);
  const path = join(logDir, `${runId}.jsonl`);
  if (!existsSync(path)) throw new Error(`no cost log for run "${runId}" (looked for ${path})`);
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l, i) => {
      try {
        return CostLineSchema.parse(JSON.parse(l));
      } catch (e) {
        throw new Error(`${path} line ${i + 1} is not a valid cost line: ${(e as Error).message}`);
      }
    });
}

export interface Totals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  /** null once any call in the group ran on the subscription (claude-code): the sum would understate the cost. */
  usd: number | null;
}
export interface RunSummary {
  byStep: Record<string, Totals>;
  byLadder: Record<string, Totals>;
  totalUsd: number | null;
}

const addUsd = (a: number | null, b: number | null) => (a === null || b === null ? null : round(a + b));

const empty = (): Totals => ({ calls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, usd: 0 });
function add(map: Record<string, Totals>, key: string, l: CostLine) {
  const t = (map[key] ??= empty());
  t.calls += 1;
  t.inputTokens += l.inputTokens;
  t.outputTokens += l.outputTokens;
  t.cachedInputTokens += l.cachedInputTokens;
  t.usd = addUsd(t.usd, l.usd);
}

export function summarizeRun(lines: CostLine[]): RunSummary {
  const s: RunSummary = { byStep: {}, byLadder: {}, totalUsd: 0 };
  for (const l of lines) {
    add(s.byStep, l.step, l);
    add(s.byLadder, l.ladderKey, l);
    s.totalUsd = addUsd(s.totalUsd, l.usd);
  }
  return s;
}
