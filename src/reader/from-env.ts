import { createAnthropic } from '@ai-sdk/anthropic';
import type { ReaderDeps } from './pick-step.js';
import { readerLimitsFromEnv } from './repo-reader.js';

/**
 * Model A for the repo reader. Returns undefined when ANTHROPIC_API_KEY or MODEL_A_ID is missing: the workflow
 * then stops after `fetch-repo`. A bad READER_* value throws at start-up.
 */
export function readerFromEnv(env: Record<string, string | undefined>): ReaderDeps | undefined {
  const apiKey = env.ANTHROPIC_API_KEY;
  const modelId = env.MODEL_A_ID;
  if (!apiKey || !modelId) return undefined;
  return { model: createAnthropic({ apiKey })(modelId), limits: readerLimitsFromEnv(env) };
}
