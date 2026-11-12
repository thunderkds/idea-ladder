import { SQL } from "bun";
import { serve } from "inngest/hono";
import { createApp } from "./app.ts";
import { ConfigError, loadConfig } from "./config.ts";
import { githubRepoClient } from "./github-repo.ts";
import { createInngest, LADDER_GENERATE_EVENT, ladderGenerateFunction } from "./ladder-generate.ts";

let config: ReturnType<typeof loadConfig>;
try {
  config = loadConfig(process.env);
} catch (err) {
  if (!(err instanceof ConfigError)) throw err;
  console.error(err.message);
  process.exit(1);
}

const sql = new SQL(config.databaseUrl);
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
    functions: [ladderGenerateFunction(inngest, { sql, github })],
    // Never derive the callback origin from the request Host header (required in production by loadConfig).
    ...(config.inngestServeOrigin ? { serveOrigin: config.inngestServeOrigin } : {}),
  }),
});
const server = Bun.serve({ port: config.port, fetch: app.fetch });
console.log(`Idea Ladder listening on http://localhost:${server.port}`);
