import pg from 'pg';
import { createApp } from '../../src/app.js';
import { SESSION_COOKIE } from '../../src/auth/cookies.js';
import { createSession, upsertUser } from '../../src/auth/session.js';
import { loadConfig } from '../../src/config.js';
import type { Enqueue, LadderRequested } from '../../src/start/service.js';
import { createTempDb, runMigrate, type TempDb } from './db.js';

export const SECRET = 's'.repeat(48);

export interface TestApp {
  db: TempDb;
  pool: pg.Pool;
  app: ReturnType<typeof createApp>;
  config: ReturnType<typeof loadConfig>;
  /** Events the app tried to send. */
  events: LadderRequested[];
  /** Cookie header for a freshly signed-in learner. */
  signIn: (githubId?: number) => Promise<string>;
  close: () => Promise<void>;
}

export async function startTestApp(opts: { fetchImpl?: typeof fetch; enqueue?: Enqueue; apiBaseUrl?: string; oauthBaseUrl?: string } = {}): Promise<TestApp> {
  const db = await createTempDb();
  await runMigrate(db.url, 'up');
  const pool = new pg.Pool({ connectionString: db.url });
  const config = loadConfig({
    DATABASE_URL: db.url,
    GITHUB_CLIENT_ID: 'test-client',
    GITHUB_CLIENT_SECRET: 'test-secret',
    SESSION_SECRET: SECRET,
    GITHUB_API_BASE_URL: opts.apiBaseUrl ?? 'https://api.github.com',
    ...(opts.oauthBaseUrl ? { GITHUB_OAUTH_BASE_URL: opts.oauthBaseUrl } : {}),
    GITHUB_APP_TOKEN: 'test-app-token',
    APP_BASE_URL: 'http://localhost:3000',
  });
  const events: LadderRequested[] = [];
  const enqueue: Enqueue = opts.enqueue ?? (async (data) => void events.push(data));
  const app = createApp({ config, pool, fetchImpl: opts.fetchImpl, enqueue });
  return {
    db,
    pool,
    app,
    config,
    events,
    signIn: async (githubId = 42) => {
      const userId = await upsertUser(pool, { id: String(githubId), login: `user${githubId}` });
      return `${SESSION_COOKIE}=${await createSession(pool, SECRET, userId)}`;
    },
    close: async () => {
      await pool.end();
      await db.drop();
    },
  };
}

export function postStart(t: TestApp, cookie: string | undefined, body: unknown, headers: Record<string, string> = {}) {
  return t.app.request('/api/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
