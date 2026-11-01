import { defineConfig } from '@playwright/test';

const adminUrl = process.env.DATABASE_URL ?? 'postgres://idea_ladder:idea_ladder@localhost:54329/idea_ladder';
const e2eDb = new URL(adminUrl);
e2eDb.pathname = '/il_e2e';

export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4011' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: [
    { command: 'pnpm exec tsx test/stub-github-server.ts', url: 'http://127.0.0.1:4010/user', reuseExistingServer: false },
    {
      command: 'pnpm exec tsx src/server.tsx',
      url: 'http://localhost:4011/',
      reuseExistingServer: false,
      env: {
        DATABASE_URL: e2eDb.toString(),
        GITHUB_CLIENT_ID: 'e2e-client',
        GITHUB_CLIENT_SECRET: 'e2e-secret',
        SESSION_SECRET: 'e2e-session-secret-not-a-real-secret-0123456789',
        GITHUB_OAUTH_BASE_URL: 'http://127.0.0.1:4010',
        GITHUB_API_BASE_URL: 'http://127.0.0.1:4010',
        APP_BASE_URL: 'http://localhost:4011',
        PORT: '4011',
        INNGEST_DEV: '1',
        INNGEST_BASE_URL: 'http://127.0.0.1:8288',
      },
    },
    {
      // Local Inngest dev server (pinned in package.json as `inngest:dev`); it syncs the app's functions.
      command: 'pnpm dlx inngest-cli@1.46.0 dev -u http://localhost:4011/api/inngest --no-discovery --retry-interval 1',
      url: 'http://127.0.0.1:8288/',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
