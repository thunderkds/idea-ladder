import { createAnthropic } from "@ai-sdk/anthropic";
import { SQL } from "bun";
import { serve } from "inngest/hono";
import { loadPrices } from "../../eval/src/cost.ts";
import { createApp } from "./app.ts";
import { ConfigError, loadConfig } from "./config.ts";
import { readerCostLogger } from "./cost-wiring.ts";
import { createOpenAIEmbedder } from "./embedder.ts";
import { githubRepoClient } from "./github-repo.ts";
import { createInngest, LADDER_GENERATE_EVENT, ladderGenerateFunction, type ReaderDeps } from "./ladder-generate.ts";
import { noPasses } from "./ladder-view.ts";
import { createModelA } from "./model-a.ts";
import { reminderFunction, webPushSender } from "./reminders.ts";

let config: ReturnType<typeof loadConfig>;
try {
  config = loadConfig(process.env);
} catch (err) {
  if (!(err instanceof ConfigError)) throw err;
  console.error(err.message);
  process.exit(1);
}

// API back end: every model call is priced by logStepCost; fail at start, not after a paid call, when model A has no price.
if (config.modelABackend === "api" && !Object.hasOwn(loadPrices(), config.modelAId as string)) {
  console.error(`Invalid configuration: MODEL_A_ID "${config.modelAId}" has no price in eval/prices.json`);
  process.exit(1);
}

// Embeddings (ADR 0006) are always priced: fail at start, not after a paid call, when the embedding model has no price.
if (config.openaiApiKey && !Object.hasOwn(loadPrices(), config.embeddingModelId)) {
  console.error(
    `Invalid configuration: EMBEDDING_MODEL_ID "${config.embeddingModelId}" has no price in eval/prices.json`,
  );
  process.exit(1);
}
if (!config.openaiApiKey)
  console.warn("OPENAI_API_KEY is not set: step chunk-and-embed fails every ladder job (embedder-not-configured)");

const sql = new SQL(config.databaseUrl);
const limits = { maxSteps: config.readerMaxSteps, tokenBudget: config.readerTokenBudget };
const logCost = readerCostLogger();
// claude-code (default): `claude -p` on the subscription; its MCP server reads GitHub with the app token.
// api: the Anthropic provider, explicit base URL (never an ANTHROPIC_BASE_URL from the environment).
const reader: ReaderDeps =
  config.modelABackend === "claude-code"
    ? {
        backend: "claude-code",
        modelId: config.modelAId,
        githubToken: config.githubAppToken,
        githubApiBaseUrl: config.githubApiBaseUrl,
        limits,
        logCost,
      }
    : {
        backend: "api",
        model: createAnthropic({ apiKey: config.anthropicApiKey, baseURL: "https://api.anthropic.com/v1" })(
          config.modelAId as string,
        ),
        limits,
        logCost,
      };
const embedder = createOpenAIEmbedder({ apiKey: config.openaiApiKey, modelId: config.embeddingModelId });
// Model A for the concept mapper (and later T008, T014): the same back end as the reader.
const modelA = createModelA(
  config.modelABackend === "claude-code"
    ? { backend: "claude-code", modelId: config.modelAId }
    : {
        backend: "api",
        model: createAnthropic({ apiKey: config.anthropicApiKey, baseURL: "https://api.anthropic.com/v1" })(
          config.modelAId as string,
        ),
      },
);
const github = githubRepoClient({ baseUrl: config.githubApiBaseUrl, token: config.githubAppToken });
const inngest = createInngest();
// T015: reminders are off (the tick does nothing) unless all three VAPID variables are set.
const reminders = reminderFunction(inngest, {
  sql,
  sendPush: config.vapid ? webPushSender(config.vapid) : async () => {},
  passedLevels: noPasses, // the app's default seam until T012
  configured: !!config.vapid,
  now: () => new Date(),
});
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
    functions: [
      ladderGenerateFunction(inngest, { sql, github, reader, modelA, embedder, dedupeCosine: config.dedupeCosine }),
      reminders,
    ],
    // Never derive the callback origin from the request Host header (required in production by loadConfig).
    ...(config.inngestServeOrigin ? { serveOrigin: config.inngestServeOrigin } : {}),
  }),
});
const server = Bun.serve({ port: config.port, fetch: app.fetch });
console.log(`Idea Ladder listening on http://localhost:${server.port}`);
