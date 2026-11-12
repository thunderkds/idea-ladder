// e2e web server: fresh database, migrated; GitHub OAuth stub; the app serving the built client.
import { SQL } from "bun";
import { createApp } from "../src/server/app.ts";
import { loadConfig } from "../src/server/config.ts";
import { migrateUp } from "../src/server/migrate.ts";
import { adminUrl } from "../tests/support/db.ts";
import { startGithubStub } from "../tests/support/github-stub.ts";

export const APP_PORT = 54401;
const STUB_PORT = 54400;
const DB_NAME = "il_e2e";

const admin = new SQL(adminUrl);
await admin.unsafe(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
await admin.unsafe(`CREATE DATABASE "${DB_NAME}"`);
await admin.close();
const dbUrl = new URL(adminUrl);
dbUrl.pathname = `/${DB_NAME}`;
const sql = new SQL(dbUrl.toString());
await migrateUp(sql);

const stub = startGithubStub({
  user: { id: 42, login: "octo" },
  clientId: "e2e-client-id",
  clientSecret: "e2e-client-secret",
  callbackUrl: `http://localhost:${APP_PORT}/auth/github/callback`,
  port: STUB_PORT,
});
const config = loadConfig({
  DATABASE_URL: dbUrl.toString(),
  GITHUB_CLIENT_ID: "e2e-client-id",
  GITHUB_CLIENT_SECRET: "e2e-client-secret",
  SESSION_SECRET: crypto.randomUUID() + crypto.randomUUID(),
  GITHUB_OAUTH_BASE_URL: stub.url,
  GITHUB_API_BASE_URL: stub.url,
  NODE_ENV: "test",
  PORT: String(APP_PORT),
});
Bun.serve({ port: APP_PORT, fetch: createApp({ config, sql, clientDir: "dist/client" }).fetch });
console.log(`e2e server on http://localhost:${APP_PORT} (stub GitHub ${stub.url})`);
