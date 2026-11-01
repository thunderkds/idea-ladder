// Every model call of a job goes through T004's logStepCost (eval/src/cost.ts), keyed by job id.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { logStepCost, priceSchema, type PriceTable } from '../../eval/src/cost.js';
import { z } from 'zod';
import { STEP_NAME, type ReaderCostSink } from './repo-reader.js';

let prices: Promise<PriceTable> | undefined;
/** Prices live in eval/prices.json; the path is relative to the working directory so a built app finds the same file. */
const loadPrices = () => (prices ??= readFile(resolve(process.cwd(), 'eval/prices.json'), 'utf8').then((t) => z.record(z.string(), priceSchema).parse(JSON.parse(t))));

/**
 * A logging failure (a model with no price, a full disk) is printed and the step goes on: the paid call is done,
 * and failing the step would only pay for it again on retry.
 */
export function jobCostSink(jobId: string, repo: string, sha: string): ReaderCostSink {
  return async (call) => {
    try {
      await logStepCost({ runId: jobId, ladderKey: `${repo}@${sha}`, step: STEP_NAME, ...call }, { prices: await loadPrices() });
    } catch (err) {
      console.error(`cost log failed for job ${jobId}:`, err instanceof Error ? err.message : err);
    }
  };
}
