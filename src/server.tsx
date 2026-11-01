import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { createPool } from './db.js';
import { readerFromEnv } from './reader/from-env.js';

let config;
try {
  config = loadConfig(process.env);
} catch (e) {
  if (e instanceof ConfigError) {
    console.error(`Cannot start: ${e.problems.join('; ')}. See .env.example.`);
    process.exit(1);
  }
  throw e;
}

const pool = createPool(config.databaseUrl);
const server = serve({ fetch: createApp({ config, pool, reader: readerFromEnv(process.env) }).fetch, port: config.port }, (info) => {
  console.log(`Idea Ladder listening on http://localhost:${info.port}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close();
    void pool.end().then(() => process.exit(0));
  });
}
