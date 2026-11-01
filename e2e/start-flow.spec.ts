import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import pg from 'pg';

const STUB = 'http://127.0.0.1:4010';
const viewports = [
  { name: 'mobile', width: 360, height: 740 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 },
];

const dbUrl = new URL(process.env.DATABASE_URL ?? 'postgres://idea_ladder:idea_ladder@localhost:54329/idea_ladder');
dbUrl.pathname = '/il_e2e';

async function signIn(page: Page, request: APIRequestContext, id = 42) {
  await request.post(`${STUB}/__stub/user`, { data: { id, login: `octo${id}` } });
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in with GitHub' }).click();
  await expect(page.getByRole('heading', { name: 'My ladders' })).toBeVisible();
}

async function expectedToken(page: Page, prop: 'color' | 'fontFamily' | 'fontSize' | 'fontWeight', token: string) {
  return page.evaluate(
    ([p, t]) => {
      const probe = document.createElement('div');
      (probe.style as unknown as Record<string, string>)[p as string] = `var(${t})`;
      document.body.appendChild(probe);
      const v = (getComputedStyle(probe) as unknown as Record<string, string>)[p as string] as string;
      probe.remove();
      return v;
    },
    [prop, token] as const,
  );
}

async function noHorizontalScroll(page: Page, width: number) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
}

test('signed-in learner opens /start?url=: lands on the job page, sees "Reading the repo", then "Done"', async ({ page, request }) => {
  await signIn(page, request);
  await request.post(`${STUB}/__stub/hold`, { data: { repo: 'lukeed/dset' } });

  await page.goto('/start?url=' + encodeURIComponent('https://github.com/lukeed/dset'));
  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Reading the repo' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('lukeed/dset')).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/job-running-desktop.png' });

  await request.post(`${STUB}/__stub/release`, { data: { repo: 'lukeed/dset' } });
  await expect(page.getByRole('heading', { name: 'Done' })).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: 'e2e/screenshots/job-done-desktop.png' });

  // The page reached Done through Inngest: the snapshot and the confidence are in the database.
  const db = new pg.Client({ connectionString: dbUrl.toString() });
  await db.connect();
  try {
    const snap = await db.query(`SELECT commit_sha FROM repo_snapshots WHERE repo_full_name = 'lukeed/dset'`);
    expect(snap.rows[0].commit_sha).toBe('05b1ec0f8cebe3b5d5667285bc7da90f38a7215e');
    const conf = await db.query(`SELECT level FROM repo_confidence WHERE repo_full_name = 'lukeed/dset'`);
    expect(conf.rows[0].level).toBe('high');
  } finally {
    await db.end();
  }
});

test('signed out: /start?url= goes through sign-in and comes back to the job page', async ({ page, request }) => {
  await request.post(`${STUB}/__stub/user`, { data: { id: 43, login: 'octo43' } });
  await page.goto('/start?url=' + encodeURIComponent('developit/mitt'));
  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: /Queued|Reading the repo|Done/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Done' })).toBeVisible({ timeout: 30_000 });
});

test('rate limit in the background step: the page shows "Failed: rate-limited" and the reset time', async ({ page, request }) => {
  await signIn(page, request);
  const reset = Math.floor(Date.UTC(2031, 0, 2, 3, 4, 5) / 1000);
  await request.post(`${STUB}/__stub/rate-limit`, { data: { repo: 'the-pocket/pocketflow', resetEpochSeconds: reset } });
  await page.goto('/start?url=' + encodeURIComponent('https://github.com/The-Pocket/PocketFlow'));
  await expect(page.getByRole('heading', { name: 'Failed: rate-limited' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('2031-01-02 03:04 UTC')).toBeVisible();
  const text = await page.locator('main').innerText();
  expect(text).not.toMatch(/\{"|stack|Error:/);
  await page.screenshot({ path: 'e2e/screenshots/job-failed-desktop.png' });
});

test('retries run out in the background step: the job ends "Failed: github-error", not stuck running', async ({ page, request }) => {
  test.setTimeout(120_000);
  await signIn(page, request);
  await request.post(`${STUB}/__stub/fail`, { data: { repo: 'the-pocket/pocketflow' } });
  await page.goto('/start?url=' + encodeURIComponent('https://github.com/The-Pocket/PocketFlow'));
  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Failed: github-error' })).toBeVisible({ timeout: 100_000 });
  await expect(page.getByRole('link', { name: 'Try again' })).toBeVisible();
});

test('unsupported URL: the page says only GitHub repo URLs work and shows the given URL escaped', async ({ page, request }) => {
  await signIn(page, request);
  const given = 'https://gitlab.com/o/n/<b>x</b>';
  await page.goto('/start?url=' + encodeURIComponent(given));
  await expect(page.getByRole('heading', { name: 'Not supported yet' })).toBeVisible();
  await expect(page.getByText('Only GitHub repository URLs work for now')).toBeVisible();
  await expect(page.locator('code')).toHaveText(given);
  await expect(page.locator('main b')).toHaveCount(0);
  await page.screenshot({ path: 'e2e/screenshots/start-unsupported-desktop.png' });
});

test('job page API is private to signed-in learners', async ({ request }) => {
  const res = await request.get('/api/jobs/00000000-0000-4000-8000-000000000000', { maxRedirects: 0 });
  expect(res.status()).toBe(401);
});

test.describe('job page design: tokens, layout and screenshots for every state', () => {
  const states = [
    { key: 'queued', status: 'queued', reason: null, heading: 'Queued' },
    { key: 'running', status: 'running', reason: null, heading: 'Reading the repo' },
    { key: 'done', status: 'fetched', reason: null, heading: 'Done' },
    { key: 'failed', status: 'failed', reason: 'rate-limited', heading: 'Failed: rate-limited' },
  ];

  async function seedJob(status: string, reason: string | null) {
    const db = new pg.Client({ connectionString: dbUrl.toString() });
    await db.connect();
    try {
      const sha = [...crypto.getRandomValues(new Uint8Array(20))].map((b) => b.toString(16).padStart(2, '0')).join('');
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO generation_jobs (repo_full_name, commit_sha, status, reason, reset_at)
         VALUES ('a-very-long-owner-name-for-wrapping/a-very-long-repository-name-that-must-wrap-on-small-screens', $1, $2, $3, $4) RETURNING id`,
        [sha, status, reason, reason ? new Date('2031-01-02T03:04:05Z') : null],
      );
      return (rows[0] as { id: string }).id;
    } finally {
      await db.end();
    }
  }

  for (const state of states) {
    for (const vp of viewports) {
      test(`${state.key} at ${vp.name} ${vp.width}px`, async ({ page, request }) => {
        await signIn(page, request);
        const id = await seedJob(state.status, state.reason);
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(`/jobs/${id}`);
        const h1 = page.getByRole('heading', { name: state.heading });
        await expect(h1).toBeVisible();
        await noHorizontalScroll(page, vp.width);
        if (vp.name === 'desktop') {
          expect(((await page.locator('main').boundingBox()) as { width: number }).width).toBeLessThanOrEqual(641);
        }
        // computed styles come from the tokens file
        const style = (sel: string, prop: string) =>
          page.locator(sel).first().evaluate((el, p) => (getComputedStyle(el) as unknown as Record<string, string>)[p as string], prop);
        expect(await style('h1', 'color')).toBe(await expectedToken(page, 'color', '--color-text'));
        expect(await style('h1', 'fontSize')).toBe(await expectedToken(page, 'fontSize', '--font-size-h1'));
        expect(await style('h1', 'fontWeight')).toBe(await expectedToken(page, 'fontWeight', '--font-weight-strong'));
        expect(await style('h1', 'fontFamily')).toBe(await expectedToken(page, 'fontFamily', '--font-family-base'));
        expect(await style('.muted', 'color')).toBe(await expectedToken(page, 'color', '--color-muted'));
        await page.screenshot({ path: `e2e/screenshots/job-${state.key}-${vp.name}.png` });
      });
    }
  }
});
