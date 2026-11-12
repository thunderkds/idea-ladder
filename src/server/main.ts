import { createAnthropic } from "@ai-sdk/anthropic";
import { SQL } from "bun";
import { serve } from "inngest/hono";
import { loadPrices, logStepCost } from "../../eval/src/cost.ts";
import { createApp } from "./app.ts";
import { ConfigError, loadConfig } from "./config.ts";
import { githubRepoClient } from "./github-repo.ts";
import { createInngest, LADDER_GENERATE_EVENT, ladderGenerateFunction, type ReaderDeps } from "./ladder-generate.ts";

let config: ReturnType<typeof loadConfig>;
try {
  config = loadConfig(process.env);
} catch (err) {
  if (!(err instanceof ConfigError)) throw err;
  console.error(err.message);
  process.exit(1);
}

// Every model call is priced by logStepCost; fail at start, not after a paid call, when model A has no price.
if (!Object.hasOwn(loadPrices(), config.modelAId)) {
  console.error(`Invalid configuration: MODEL_A_ID "${config.modelAId}" has no price in eval/prices.json`);
  process.exit(1);
}

const sql = new SQL(config.databaseUrl);
const reader: ReaderDeps = {
  model: createAnthropic({ apiKey: config.anthropicApiKey })(config.modelAId),
  limits: { maxSteps: config.readerMaxSteps, tokenBudget: config.readerTokenBudget },
  logCost: ({ jobId, repo, sha, step, model, inputTokens, outputTokens, cachedInputTokens }) =>
    logStepCost({
      runId: `job-${jobId}`,
      ladderKey: `${repo}@${sha}`,
      step,
      model,
      inputTokens,
      outputTokens,
      cachedInputTokens,
    }),
};
const github = githubRepoClient({ baseUrl: config.githubApiBaseUrl, token: config.githubAppToken });
const inngest = createInngest();
const app = createApp({
  config,
  sql,
  clientDir: "dist/client",
  github,
  // Event id = job id, so Inngest drops a duplicate send for the same job.
  enqueue: async (data) => {
    await inngest.send({ id: data.jobId, name: LADDER_GENERATE_EVENT, data });
  },
  inngestHandler: serve({
    client: inngest,
    functions: [ladderGenerateFunction(inngest, { sql, github, reader })],
    // Never derive the callback origin from the request Host header (required in production by loadConfig).
    ...(config.inngestServeOrigin ? { serveOrigin: config.inngestServeOrigin } : {}),
  }),
});
const server = Bun.serve({ port: config.port, fetch: app.fetch });
console.log(`Idea Ladder listening on http://localhost:${server.port}`);
