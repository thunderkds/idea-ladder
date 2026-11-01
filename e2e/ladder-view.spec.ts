import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import pg from 'pg';

const STUB = 'http://127.0.0.1:4010';
const MITT_SHA = '6b41670516ed8e8b738612f60491995470aa63b3';
const viewports = [
  { name: 'mobile', width: 360, height: 740 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 },
];

const dbUrl = new URL(process.env.DATABASE_URL ?? 'postgres://idea_ladder:idea_ladder@localhost:54329/idea_ladder');
dbUrl.pathname = '/il_e2e';

let db: pg.Client;
let mittLadder: string;
let dsetLadder: string;

async function signIn(page: Page, request: APIRequestContext, id = 42) {
  await request.post(`${STUB}/__stub/user`, { data: { id, login: `octo${id}` } });
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in with GitHub' }).click();
  await expect(page.getByRole('heading', { name: 'My ladders' })).toBeVisible();
}

async function computed(page: Page, selector: string, prop: string) {
  return page.locator(selector).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
}

async function tokenValue(page: Page, prop: 'color' | 'fontSize' | 'fontWeight', token: string) {
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

test.beforeAll(async () => {
  db = new pg.Client({ connectionString: dbUrl.toString() });
  await db.connect();
  await db.query('DROP TABLE IF EXISTS levels');
  await db.query(`CREATE TABLE levels (ladder_id uuid, level_id text, goal text, pass_test_kind text, pass_test_description text)`);
  mittLadder = (await db.query(`INSERT INTO ladders (repo_full_name, commit_sha) VALUES ('developit/mitt', $1) RETURNING id`, [MITT_SHA])).rows[0].id;
  dsetLadder = (await db.query(`INSERT INTO ladders (repo_full_name, commit_sha) VALUES ('lukeed/dset', $1) RETURNING id`, ['05b1ec0f8cebe3b5d5667285bc7da90f38a7215e'])).rows[0].id;
  const rows: [string, string, string, string][] = [
    ['L0', 'Know what an event emitter is and how subscribers are stored', 'concept-mcq', 'Concept ladder tests'],
    ['L1', 'Clone mitt, run its tests and explain what the library does', 'run-log-and-explanation', 'Screenshot or log + 3-sentence explanation'],
    ['L2', 'Add one small option to on() and open a branch for it', 'branch-diff-and-diff-questions', 'Branch or diff link + questions generated from your diff'],
    ['L3', 'Explain how the handler map is read when emit() runs, with averyveryveryverylongwordthatshouldwrapinsideitscardwithoutoverflowingthepage1234567890', 'verified-mcq', 'Verified MCQs on core files'],
    ['L4', 'Rebuild a minimal emitter from scratch, or get a PR merged', 'repo-or-merged-pr', 'Repo link or PR link'],
  ];
  for (const [id, goal, kind, desc] of rows) {
    await db.query(`INSERT INTO levels VALUES ($1, $2, $3, $4, $5)`, [mittLadder, id, goal, kind, desc]);
  }
});

test.afterAll(async () => {
  await db.query('DROP TABLE IF EXISTS levels');
  await db.query(`DELETE FROM generation_jobs WHERE repo_full_name IN ('developit/mitt', 'lukeed/dset')`);
  await db.query(`DELETE FROM ladders WHERE id IN ($1, $2)`, [mittLadder, dsetLadder]);
  await db.end();
});

test('seeded ladder: 5 levels in order, Unverified badge, 7-char SHA, link-outs, one open level, four locked', async ({ page, request, context }) => {
  await signIn(page, request);
  await page.goto(`/ladders/${mittLadder}`);
  await expect(page.getByRole('heading', { name: 'developit/mitt', level: 1 })).toBeVisible();
  await expect(page.locator('.level-title')).toHaveText(['L0 Prerequisites', 'L1 Run it', 'L2 Modify', 'L3 Understand', 'L4 Rebuild or contribute']);
  await expect(page.getByText('Clone mitt, run its tests')).toBeVisible();
  await expect(page.getByText('Pass test: Concept ladder tests')).toBeVisible();
  await expect(page.locator('.badge')).toHaveText('Unverified');
  await expect(page.locator('.badge')).toHaveAttribute('title', 'AI-drafted, not yet reviewed by people');
  await expect(page.locator('.ladder-meta code')).toHaveText('6b41670');
  const readme = page.getByRole('link', { name: 'Read the README' });
  const wiki = page.getByRole('link', { name: 'Open in DeepWiki' });
  await expect(readme).toHaveAttribute('href', `https://github.com/developit/mitt/blob/${MITT_SHA}/README.md`);
  await expect(wiki).toHaveAttribute('href', 'https://deepwiki.com/developit/mitt');
  for (const link of [readme, wiki]) {
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  }
  // The link-out opens in a new tab (the destination is not fetched: no network in tests).
  await context.route('https://github.com/**', (route) => route.fulfill({ status: 200, body: 'stub readme' }));
  const [popup] = await Promise.all([context.waitForEvent('page'), readme.click()]);
  expect(popup.url()).toBe(`https://github.com/developit/mitt/blob/${MITT_SHA}/README.md`);
  await popup.close();

  await expect(page.locator('.level-open')).toHaveCount(1);
  await expect(page.locator('#level-L0')).toHaveClass(/level-open/);
  await expect(page.locator('.level-locked')).toHaveCount(4);
  await expect(page.locator('.level-locked[aria-disabled="true"]')).toHaveCount(4);
  for (const n of [1, 2, 3, 4]) await expect(page.locator(`#level-L${n}`)).toContainText(`Locked — pass L${n - 1} first`);
  await expect(page.locator('.level a')).toHaveCount(0);
  await expect(page.getByText(/explain(s|ed)? (the )?repo/i)).toHaveCount(0);
});

test('design tokens: level cards, badge and text use the T003 tokens; locked text keeps its contrast', async ({ page, request }) => {
  await signIn(page, request);
  await page.goto(`/ladders/${mittLadder}`);
  expect(await computed(page, '.level-open', 'border-top-color')).toBe(await tokenValue(page, 'color', '--color-accent'));
  expect(await computed(page, '.level-locked', 'border-top-color')).toBe(await tokenValue(page, 'color', '--color-border'));
  expect(await computed(page, '.level-locked .level-state', 'color')).toBe(await tokenValue(page, 'color', '--color-muted'));
  expect(await computed(page, '.level-title', 'font-size')).toBe(await tokenValue(page, 'fontSize', '--font-size-body'));
  expect(await computed(page, '.level-title', 'font-weight')).toBe(await tokenValue(page, 'fontWeight', '--font-weight-strong'));
  expect(await computed(page, '.badge', 'font-weight')).toBe(await tokenValue(page, 'fontWeight', '--font-weight-strong'));
  expect(await computed(page, '.levels', 'gap')).toBe(await page.evaluate(() => {
    const p = document.createElement('div');
    p.style.width = 'var(--space-3)';
    document.body.appendChild(p);
    const v = getComputedStyle(p).width;
    p.remove();
    return v;
  }));
  expect(await computed(page, '.level', 'padding-top')).toBe('16px');
  expect(await computed(page, 'body', 'font-family')).toContain('system-ui');
});

test('keyboard: Tab reaches the open level and skips locked ones; axe finds no serious or critical problem', async ({ page, request }) => {
  await signIn(page, request);
  await page.goto(`/ladders/${mittLadder}`);
  const focused: string[] = [];
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    focused.push(await page.evaluate(() => document.activeElement?.id || document.activeElement?.textContent?.trim() || document.activeElement?.tagName || ''));
  }
  expect(focused).toContain('level-L0');
  expect(focused.filter((f) => /^level-L[1-4]$/.test(f))).toEqual([]);
  await page.locator('#level-L0').focus();
  await expect(page.locator('#level-L0')).toBeFocused();
  const results = await new AxeBuilder({ page }).analyze();
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
});

for (const vp of viewports) {
  test(`layout at ${vp.name} (${vp.width}px): no horizontal scroll; screenshot`, async ({ page, request }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await signIn(page, request);
    await page.goto(`/ladders/${mittLadder}`);
    await expect(page.locator('.level')).toHaveCount(5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(vp.width);
    const links = page.locator('.ladder-links .button');
    const w = await links.first().evaluate((el) => el.getBoundingClientRect().width);
    if (vp.width === 360) expect(w).toBeGreaterThan(vp.width * 0.8);
    else expect(w).toBeLessThan(vp.width * 0.6);
    await page.screenshot({ path: `e2e/screenshots/ladder-view-${vp.name}.png`, fullPage: true });
  });
}

test('ladder with no level rows shows five levels with "Not generated yet" goals', async ({ page, request }) => {
  await signIn(page, request);
  await page.goto(`/ladders/${dsetLadder}`);
  await expect(page.locator('.level')).toHaveCount(5);
  await expect(page.getByText('Not generated yet')).toHaveCount(5);
});

test('unknown ladder id: 404 page', async ({ page, request }) => {
  await signIn(page, request);
  const res = await page.goto('/ladders/does-not-exist');
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Ladder not found' })).toBeVisible();
});

test('signed out: sign in, then land on the same ladder', async ({ page, request }) => {
  await request.post(`${STUB}/__stub/user`, { data: { id: 44, login: 'octo44' } });
  await page.goto(`/ladders/${mittLadder}`);
  await expect(page).toHaveURL(new RegExp(`/ladders/${mittLadder}$`));
  await expect(page.getByRole('heading', { name: 'developit/mitt', level: 1 })).toBeVisible();
});

test('My ladders lists the learner\'s two ladders with Open ladder links; the link opens the ladder', async ({ page, request }) => {
  await signIn(page, request, 45);
  const user = (await db.query(`SELECT id FROM users WHERE github_id = 45`)).rows[0].id;
  await db.query(`INSERT INTO generation_jobs (repo_full_name, commit_sha, status, started_by) VALUES ('developit/mitt', $1, 'fetched', $2)`, [MITT_SHA, user]);
  await db.query(`INSERT INTO generation_jobs (repo_full_name, commit_sha, status, started_by) VALUES ('lukeed/dset', '05b1ec0f8cebe3b5d5667285bc7da90f38a7215e', 'fetched', $1)`, [user]);
  await page.goto('/ladders');
  await expect(page.getByText('No ladders yet')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Open ladder/ })).toHaveCount(2);
  await expect(page.locator('code', { hasText: 'developit/mitt' })).toBeVisible();
  await expect(page.locator('code', { hasText: 'lukeed/dset' })).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/ladders-list-desktop.png' });
  await page.getByRole('link', { name: 'Open ladder developit/mitt' }).click();
  await expect(page).toHaveURL(new RegExp(`/ladders/${mittLadder}$`));
});
