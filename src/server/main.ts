import { SQL } from "bun";
import { createApp } from "./app.ts";
import { ConfigError, loadConfig } from "./config.ts";

let config: ReturnType<typeof loadConfig>;
try {
  config = loadConfig(process.env);
} catch (err) {
  if (!(err instanceof ConfigError)) throw err;
  console.error(err.message);
  process.exit(1);
}

const sql = new SQL(config.databaseUrl);
const app = createApp({ config, sql, clientDir: "dist/client" });
const server = Bun.serve({ port: config.port, fetch: app.fetch });
console.log(`Idea Ladder listening on http://localhost:${server.port}`);
