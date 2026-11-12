import { createAnthropic } from "@ai-sdk/anthropic";
import { SQL } from "bun";
import { serve } from "inngest/hono";
import { loadPrices } from "../../eval/src/cost.ts";
import { createApp } from "./app.ts";
import { ConfigError, loadConfig } from "./config.ts";
import { readerCostLogger } from "./cost-wiring.ts";
import { githubRepoClient } from "./github-repo.ts";
import { createInngest, LADDER_GENERATE_EVENT, ladderGenerateFunction, type ReaderDeps } from "./ladder-generate.ts";
import { noPasses } from "./ladder-view.ts";
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
    functions: [ladderGenerateFunction(inngest, { sql, github, reader }), reminders],
    // Never derive the callback origin from the request Host header (required in production by loadConfig).
    ...(config.inngestServeOrigin ? { serveOrigin: config.inngestServeOrigin } : {}),
  }),
});
const server = Bun.serve({ port: config.port, fetch: app.fetch });
console.log(`Idea Ladder listening on http://localhost:${server.port}`);
