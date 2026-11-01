import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import pg from 'pg';

const STUB = 'http://127.0.0.1:4010';
const viewports = [
  { name: 'mobile', width: 360, height: 740 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 },
];

const dbUrl = new URL(process.env.DATABASE_URL ?? 'postgres://idea_ladder:idea_ladder@localhost:54329/idea_ladder');
dbUrl.pathname = '/il_e2e';

let db: pg.Client;

test.beforeAll(async () => {
  db = new pg.Client({ connectionString: dbUrl.toString() });
  await db.connect();
});
test.afterAll(async () => {
  await db.end();
});

interface Learner {
  githubId: number;
  userId: string;
  ladderId: string;
}

/** Signs in through the stub OAuth server, then starts a ladder for the learner. Each test uses its own learner. */
async function learner(page: Page, request: APIRequestContext): Promise<Learner> {
  const githubId = 100_000 + Math.floor(Math.random() * 800_000);
  await request.post(`${STUB}/__stub/user`, { data: { id: githubId, login: `rev${githubId}` } });
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in with GitHub' }).click();
  await expect(page.getByRole('heading', { name: 'My ladders' })).toBeVisible();
  const userId = (await db.query(`SELECT id FROM users WHERE github_id = $1`, [githubId])).rows[0].id;
  const repo = `rev/repo${githubId}`;
  const sha = randomBytes(20).toString('hex');
  const ladderId = (await db.query(`INSERT INTO ladders (repo_full_name, commit_sha) VALUES ($1, $2) RETURNING id`, [repo, sha])).rows[0].id;
  await db.query(`INSERT INTO generation_jobs (repo_full_name, commit_sha, status, started_by) VALUES ($1, $2, 'fetched', $3)`, [repo, sha, userId]);
  await db.query(`INSERT INTO ladder_learners (user_id, repo_full_name, commit_sha) VALUES ($1, $2, $3)`, [userId, repo, sha]);
  return { githubId, userId, ladderId };
}

/** One card; with `dueMinutesAgo` the learner already has a state for it (due that long ago). */
async function addCard(l: Learner, level: string, front: string, dueMinutesAgo?: number): Promise<string> {
  const id = (await db.query(`INSERT INTO cards (ladder_id, level_id, front, back) VALUES ($1, $2, $3, $4) RETURNING id`, [l.ladderId, level, front, `Answer to: ${front}`])).rows[0].id;
  if (dueMinutesAgo !== undefined) {
    await db.query(
      `INSERT INTO card_states (user_id, card_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review)
       VALUES ($1, $2, now() - make_interval(mins => $3), 5, 5, 0, 5, 0, 3, 0, 2, now() - interval '5 days')`,
      [l.userId, id, dueMinutesAgo],
    );
  }
  return id;
}

const logCount = async (l: Learner) => Number((await db.query(`SELECT count(*) AS n FROM review_log WHERE user_id = $1`, [l.userId])).rows[0].n);

function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

async function token(page: Page, prop: 'color' | 'fontSize', name: string) {
  return page.evaluate(
    ([p, n]) => {
      const probe = document.createElement('div');
      (probe.style as unknown as Record<string, string>)[p as string] = `var(${n})`;
      document.body.appendChild(probe);
      const v = (getComputedStyle(probe) as unknown as Record<string, string>)[p as string] as string;
      probe.remove();
      return v;
    },
    [prop, name] as const,
  );
}
const style = (page: Page, selector: string, prop: string) => page.locator(selector).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

test('T011 full session: cards in due order, answer hidden until Space, keys 1-4 rate, locked-level cards never shown', async ({ page, request }) => {
  const errors = watchConsole(page);
  const l = await learner(page, request);
  await addCard(l, 'L0', 'Second question', 30);
  await addCard(l, 'L0', 'First question', 90);
  await addCard(l, 'L0', 'Third question', 5);
  await addCard(l, 'L1', 'Locked question', 200);
  await page.goto('/review');
  await expect(page.getByRole('timer')).toContainText('Time left 5:00');
  await expect(page.getByText('First question', { exact: true })).toBeVisible();
  await expect(page.getByText('Answer to: First question')).toBeHidden();
  await expect(page.getByRole('button', { name: /^(Again|Hard|Good|Easy)$/ })).toHaveCount(0);
  await page.keyboard.press('Space');
  await expect(page.getByText('Answer to: First question')).toBeVisible();
  await expect(page.locator('.review-ratings button')).toHaveText(['Again', 'Hard', 'Good', 'Easy']);
  await page.keyboard.press('3');
  await expect(page.getByText('Second question', { exact: true })).toBeVisible();
  await page.keyboard.press('Space');
  await page.getByRole('button', { name: 'Hard' }).click();
  await expect(page.getByText('Third question', { exact: true })).toBeVisible();
  await page.keyboard.press('Space');
  await page.keyboard.press('4');
  await expect(page.getByRole('heading', { name: 'Session finished' })).toBeVisible();
  await expect(page.getByText('You rated 3 cards.')).toBeVisible();
  await expect(page.getByText('Locked question')).toHaveCount(0);
  expect(await logCount(l)).toBe(3);
  const ratings = (await db.query(`SELECT rating FROM review_log WHERE user_id = $1 ORDER BY id`, [l.userId])).rows.map((r) => r.rating);
  expect(ratings).toEqual([3, 2, 4]);
  expect(errors).toEqual([]);
});

test('T011 five-minute cap: at 4:59 the shown card can still be rated, then the session ends and no new card is shown', async ({ page, request }) => {
  const l = await learner(page, request);
  await addCard(l, 'L0', 'Card one', 60);
  await addCard(l, 'L0', 'Card two', 30);
  await addCard(l, 'L0', 'Card three', 10);
  await page.clock.install();
  await page.goto('/review');
  await expect(page.getByText('Card one', { exact: true })).toBeVisible();
  await page.clock.fastForward('04:59');
  await expect(page.getByText('Card one', { exact: true })).toBeVisible();
  await expect(page.getByRole('timer')).toContainText('Time left 0:');
  await page.keyboard.press('Space');
  await page.clock.fastForward('00:02');
  await expect(page.getByRole('timer')).toContainText('Time left 0:00');
  await expect(page.getByText('Card one', { exact: true })).toBeVisible();
  await page.keyboard.press('3');
  await expect(page.getByRole('heading', { name: 'Session finished' })).toBeVisible();
  await expect(page.getByText('Time is up. Cards you did not rate stay due for the next session.')).toBeVisible();
  await expect(page.getByText('You rated 1 card.')).toBeVisible();
  await expect(page.getByText('Card two', { exact: true })).toHaveCount(0);
  expect(await logCount(l)).toBe(1);
  // The two unrated cards are still due.
  const queue = await (await page.request.get('/api/review/queue')).json();
  expect(queue.cards.map((c: { front: string }) => c.front)).toEqual(['Card two', 'Card three']);
  await page.screenshot({ path: 'e2e/screenshots/review-session-end-desktop.png' });
});

test('T011 five-minute cap holds when the timer tick is late: a rating after 5:00 shows no new card', async ({ page, request }) => {
  const l = await learner(page, request);
  await addCard(l, 'L0', 'Late one', 60);
  await addCard(l, 'L0', 'Late two', 30);
  await page.clock.install();
  await page.goto('/review');
  await expect(page.getByText('Late one', { exact: true })).toBeVisible();
  await page.keyboard.press('Space');
  // A background tab delays timers: the clock passes 5:00 and no timer callback runs.
  const started = await page.evaluate(() => Date.now());
  await page.clock.setSystemTime(started + 301_000);
  await page.keyboard.press('3');
  await expect(page.getByRole('heading', { name: 'Session finished' })).toBeVisible();
  await expect(page.getByText('Late two', { exact: true })).toHaveCount(0);
});

test('T011 empty state without cards: "No cards yet", no error, one queue request', async ({ page, request }) => {
  const errors = watchConsole(page);
  const queueCalls: string[] = [];
  page.on('request', (r) => r.url().includes('/api/review/queue') && queueCalls.push(r.url()));
  await learner(page, request);
  await page.goto('/review');
  await expect(page.getByRole('heading', { name: 'No cards yet' })).toBeVisible();
  await expect(page.getByText('Nothing due')).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(queueCalls).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('T011 empty state with cards not due: "Nothing due" and the next due time', async ({ page, request }) => {
  const errors = watchConsole(page);
  const later = await learner(page, request);
  const id = await addCard(later, 'L0', 'Not due yet');
  await db.query(
    `INSERT INTO card_states (user_id, card_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review)
     VALUES ($1, $2, now() + interval '2 days', 5, 5, 0, 5, 0, 3, 0, 2, now())`,
    [later.userId, id],
  );
  await page.goto('/review');
  await expect(page.getByRole('heading', { name: 'Nothing due' })).toBeVisible();
  await expect(page.getByText(/^Next due: /)).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/review-empty-desktop.png' });
  expect(errors).toEqual([]);
});

test('T011 server error: the card stays on screen with Retry; the retry reuses the key and writes one log row', async ({ page, request }) => {
  const l = await learner(page, request);
  await addCard(l, 'L0', 'Flaky question', 10);
  await page.goto('/review');
  const keys: string[] = [];
  let calls = 0;
  await page.route('**/api/review/rating', async (route) => {
    keys.push(JSON.parse(route.request().postData() ?? '{}').idempotencyKey);
    calls += 1;
    if (calls === 1) await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' });
    else await route.continue();
  });
  await expect(page.getByText('Flaky question', { exact: true })).toBeVisible();
  await page.keyboard.press('Space');
  await page.keyboard.press('3');
  await expect(page.getByRole('alert')).toContainText('The rating was not saved');
  await expect(page.getByText('Flaky question', { exact: true })).toBeVisible();
  expect(await logCount(l)).toBe(0);
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('heading', { name: 'Session finished' })).toBeVisible();
  expect(keys[1]).toBe(keys[0]);
  expect(await logCount(l)).toBe(1);
});

test('T011 Start review links: ladder view and My ladders open the review screen', async ({ page, request }) => {
  const l = await learner(page, request);
  await page.goto('/ladders');
  await page.getByRole('link', { name: 'Start review' }).click();
  await expect(page).toHaveURL(/\/review$/);
  await page.goto(`/ladders/${l.ladderId}`);
  await page.getByRole('link', { name: 'Start review' }).click();
  await expect(page).toHaveURL(/\/review$/);
  await expect(page.getByRole('heading', { name: 'Daily review' })).toBeVisible();
});

for (const vp of viewports) {
  test(`T011 layout at ${vp.name} (${vp.width}px): tokens, tap targets, gaps, no horizontal scroll, axe, screenshots`, async ({ page, request }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const l = await learner(page, request);
    await addCard(l, 'L0', 'What does emit() do when no handler is registered for the event type?', 10);
    await page.goto('/review');
    await expect(page.locator('.review-card')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(vp.width);
    expect(parseFloat(await style(page, '.review-card p.wrap', 'font-size'))).toBeGreaterThanOrEqual(16);
    expect(await style(page, 'body', 'font-family')).toContain('system-ui');
    expect(await style(page, '.review-card', 'border-top-color')).toBe(await token(page, 'color', '--color-border'));
    expect(await style(page, '.review-timer', 'color')).toBe(await token(page, 'color', '--color-text'));
    expect(await style(page, '.review-card .button', 'background-color')).toBe(await token(page, 'color', '--color-accent'));
    await page.screenshot({ path: `e2e/screenshots/review-front-${vp.name}.png`, fullPage: true });

    await page.keyboard.press('Space');
    await expect(page.locator('.review-ratings button')).toHaveCount(4);
    const boxes = await page.locator('.review-ratings button').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as { x: number; y: number; width: number; height: number }));
    for (const b of boxes) {
      expect(b.height).toBeGreaterThanOrEqual(44);
      expect(b.width).toBeGreaterThanOrEqual(44);
    }
    const [a, b, c, d] = boxes as [(typeof boxes)[number], (typeof boxes)[number], (typeof boxes)[number], (typeof boxes)[number]];
    if (vp.width === 360) {
      expect([a.y === b.y, c.y === d.y, c.y > a.y]).toEqual([true, true, true]); // 2 x 2 grid
      expect(c.y - (a.y + a.height)).toBeGreaterThanOrEqual(8);
    } else {
      expect(new Set(boxes.map((x) => x.y)).size).toBe(1); // one row
    }
    expect(b.x - (a.x + a.width)).toBeGreaterThanOrEqual(8);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(vp.width);
    const bad = (await new AxeBuilder({ page }).analyze()).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => v.id)).toEqual([]);
    await page.screenshot({ path: `e2e/screenshots/review-back-${vp.name}.png`, fullPage: true });
  });
}
