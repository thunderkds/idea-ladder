import { appendFile, mkdir, readFile } from "node:fs/promises";
import { z } from "zod";

export class UnknownModelPriceError extends Error {
  constructor(public readonly model: string) {
    super(`no price for model "${model}" in prices.json; add it with a source URL and date (never log usd 0 for it)`);
    this.name = "UnknownModelPriceError";
  }
}
export class InvalidCostInputError extends Error {
  constructor(message: string) { super(message); this.name = "InvalidCostInputError"; }
}

/** USD per 1,000,000 tokens. `source` and `checkedAt` record where the number came from. */
export const priceSchema = z.object({ input: z.number().nonnegative(), output: z.number().nonnegative(), cachedInput: z.number().nonnegative(), source: z.string().min(1), checkedAt: z.string().min(1) });
export type Price = z.infer<typeof priceSchema>;
export type PriceTable = Record<string, Price>;

const tokens = z.number().int().nonnegative();
const inputSchema = z.object({
  runId: z.string().regex(/^[A-Za-z0-9._-]+$/).refine((s) => !s.startsWith("."), "must not start with '.'"),
  ladderKey: z.string().min(1),
  step: z.string().min(1),
  model: z.string().min(1),
  inputTokens: tokens,
  outputTokens: tokens,
  cachedInputTokens: tokens.default(0),
});
export type StepCostInput = z.input<typeof inputSchema>;
export interface CostRecord extends z.output<typeof inputSchema> { ts: string; usd: number }

export const DEFAULT_PRICES = new URL("../prices.json", import.meta.url);
export const DEFAULT_LOG_DIR = new URL("../cost-log/", import.meta.url);

export interface CostOptions { prices?: PriceTable; logDir?: URL | string; now?: () => Date }

async function loadPrices(): Promise<PriceTable> {
  return z.record(z.string(), priceSchema).parse(JSON.parse(await readFile(DEFAULT_PRICES, "utf8")));
}
const dirUrl = (d: URL | string) => (typeof d === "string" ? new URL(`file://${d.replace(/\/?$/, "/")}`) : d);

/**
 * Appends one JSON line to <logDir>/<runId>.jsonl and returns it. `inputTokens` are the NON-cached input tokens;
 * cached input tokens are priced separately. Throws before writing anything on bad input or an unknown model.
 */
export async function logStepCost(input: StepCostInput, opts: CostOptions = {}): Promise<CostRecord> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new InvalidCostInputError(parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "));
  const v = parsed.data;
  const price = (opts.prices ?? (await loadPrices()))[v.model];
  if (!price) throw new UnknownModelPriceError(v.model);
  const usd = Math.round(((v.inputTokens * price.input + v.cachedInputTokens * price.cachedInput + v.outputTokens * price.output) / 1e6) * 1e9) / 1e9;
  const rec: CostRecord = { ts: (opts.now ?? (() => new Date()))().toISOString(), ...v, usd };
  const dir = dirUrl(opts.logDir ?? DEFAULT_LOG_DIR);
  await mkdir(dir, { recursive: true });
  await appendFile(new URL(`${v.runId}.jsonl`, dir), JSON.stringify(rec) + "\n");
  return rec;
}

export async function readCostLog(runId: string, logDir: URL | string = DEFAULT_LOG_DIR): Promise<CostRecord[]> {
  try {
    const text = await readFile(new URL(`${runId}.jsonl`, dirUrl(logDir)), "utf8");
    return text.split("\n").filter(Boolean).map((l) => JSON.parse(l) as CostRecord);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

const round = (n: number) => Math.round(n * 1e9) / 1e9;
export function summarizeCost(records: CostRecord[]) {
  const perStep: Record<string, number> = {};
  const perLadder: Record<string, number> = {};
  let total = 0;
  for (const r of records) {
    perStep[r.step] = round((perStep[r.step] ?? 0) + r.usd);
    perLadder[r.ladderKey] = round((perLadder[r.ladderKey] ?? 0) + r.usd);
    total += r.usd;
  }
  return { perStep, perLadder, totalUsd: round(total), calls: records.length };
}
