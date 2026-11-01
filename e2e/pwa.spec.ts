import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import pg from 'pg';

const STUB = 'http://127.0.0.1:4010';
const viewports = [
  { name: 'mobile', width: 360, height: 740 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 },
];
const OFFLINE_NOTICE = 'You are offline — this needs a connection';

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
  await request.post(`${STUB}/__stub/user`, { data: { id: githubId, login: `pwa${githubId}` } });
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in with GitHub' }).click();
  await expect(page.getByRole('heading', { name: 'My ladders' })).toBeVisible();
  const userId = (await db.query(`SELECT id FROM users WHERE github_id = $1`, [githubId])).rows[0].id;
  const repo = `pwa/repo${githubId}`;
  const sha = randomBytes(20).toString('hex');
  const ladderId = (await db.query(`INSERT INTO ladders (repo_full_name, commit_sha) VALUES ($1, $2) RETURNING id`, [repo, sha])).rows[0].id;
  await db.query(`INSERT INTO generation_jobs (repo_full_name, commit_sha, status, started_by) VALUES ($1, $2, 'fetched', $3)`, [repo, sha, userId]);
  return { githubId, userId, ladderId };
}

/** A card the learner has a state for, due `dueMinutesAgo` minutes ago. */
async function addDueCard(l: Learner, front: string, dueMinutesAgo: number): Promise<string> {
  const id = (await db.query(`INSERT INTO cards (ladder_id, level_id, front, back) VALUES ($1, 'L0', $2, $3) RETURNING id`, [l.ladderId, front, `Answer to: ${front}`])).rows[0].id;
  await db.query(
    `INSERT INTO card_states (user_id, card_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review)
     VALUES ($1, $2, now() - make_interval(mins => $3), 5, 5, 0, 5, 0, 3, 0, 2, now() - interval '5 days')`,
    [l.userId, id, dueMinutesAgo],
  );
  return id;
}

/** Reads the IndexedDB of the learner from the page. */
async function readStore(page: Page, learnerId: string) {
  return page.evaluate(
    (id) =>
      new Promise<{ ratings: Array<Record<string, unknown>>; cards: Array<{ id: string; fsrs: Record<string, unknown> | null }> }>((resolve, reject) => {
        const open = indexedDB.open(`il-${id}`);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const d = open.result;
          const tx = d.transaction(['ratings', 'cards'], 'readonly');
          const ratings = tx.objectStore('ratings').getAll();
          const cards = tx.objectStore('cards').getAll();
          tx.oncomplete = () => {
            d.close();
            resolve({ ratings: ratings.result, cards: cards.result });
          };
        };
      }),
    learnerId,
  );
}

/**
 * Headless Chromium has no push service and starts with notifications blocked. This replaces the browser side (permission
 * and subscription) so the screen and the server calls run for real. A real push delivery is not shown here.
 */
async function mockPush(page: Page) {
  await page.addInitScript(() => {
    let granted = false;
    let current: { endpoint: string; toJSON: () => unknown; unsubscribe: () => Promise<boolean> } | null = null;
    Object.defineProperty(Notification, 'permission', { get: () => (granted ? 'granted' : 'default') });
    Notification.requestPermission = async () => {
      granted = true;
      return 'granted';
    };
    PushManager.prototype.subscribe = async () => {
      const endpoint = `https://fcm.googleapis.com/fcm/send/e2e-${Math.random().toString(36).slice(2)}`;
      current = {
        endpoint,
        toJSON: () => ({ endpoint, keys: { p256dh: 'BPe2eKeyForTestsOnly', auth: 'e2eAuthKey' } }),
        unsubscribe: async () => {
          current = null;
          return true;
        },
      };
      return current as unknown as PushSubscription;
    };
    PushManager.prototype.getSubscription = async () => current as unknown as PushSubscription | null;
  });
}

async function rateGood(page: Page) {
  await page.getByRole('button', { name: 'Show answer' }).click();
  await page.getByRole('button', { name: 'Good' }).click();
}

/** The service worker is active, controls the page, and has the shell and the review page cached. */
async function waitForOfflineReady(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const shell = await caches.open('il-shell-v1');
        const pages = await caches.open('il-pages-v1');
        return Boolean(await shell.match('/offline')) && Boolean(await pages.match('/review')) && Boolean(navigator.serviceWorker.controller);
      }),
    )
    .toBe(true);
}

test.describe('T015 PWA, offline review, reminders and progress file', () => {

  test('T015 AC2+3: offline review loads, 3 ratings are queued, reconnect syncs them and the states match the server', async ({ page, context, request }) => {
    const l = await learner(page, request);
    const ids = [await addDueCard(l, 'card one', 30), await addDueCard(l, 'card two', 20), await addDueCard(l, 'card three', 10)];
    await page.goto('/review');
    await expect(page.getByText('card one', { exact: true })).toBeVisible();
    await waitForOfflineReady(page);
    // The 7 day pack is saved to this device.
    await expect.poll(async () => (await readStore(page, l.userId)).cards.length).toBe(3);

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Daily review' })).toBeVisible();
    await expect(page.getByText('card one', { exact: true })).toBeVisible();
    await expect(page.locator('.offline-banner')).toContainText('You are offline');
    for (const v of viewports) {
      await page.setViewportSize({ width: v.width, height: v.height });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: `e2e/screenshots/pwa-offline-banner-${v.name}.png` });
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await rateGood(page);
    await rateGood(page);
    await rateGood(page);
    await expect(page.getByRole('heading', { name: 'Session finished' })).toBeVisible();
    const queued = await readStore(page, l.userId);
    expect(queued.ratings).toHaveLength(3);
    expect(queued.ratings.map((r) => r.cardId)).toEqual(ids);
    for (const r of queued.ratings) {
      expect(r).toMatchObject({ rating: 3 });
      expect(typeof r.idempotencyKey).toBe('string');
      expect(Number.isNaN(Date.parse(r.reviewedAt as string))).toBe(false);
    }
    await expect(page.locator('#sync-status')).toContainText('3 ratings are waiting to sync');
    expect((await db.query('SELECT count(*) AS n FROM review_log WHERE user_id = $1', [l.userId])).rows[0].n).toBe('0');

    await context.setOffline(false);
    await expect(page.locator('#sync-status')).toHaveText('');
    expect((await readStore(page, l.userId)).ratings).toHaveLength(0);
    const rows = (await db.query('SELECT * FROM review_log WHERE user_id = $1 ORDER BY id', [l.userId])).rows;
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.client_time_rejected === false)).toBe(true);
    const local = (await readStore(page, l.userId)).cards;
    for (const id of ids) {
      const server = (await db.query('SELECT * FROM card_states WHERE user_id = $1 AND card_id = $2', [l.userId, id])).rows[0];
      const device = local.find((c) => c.id === id)!.fsrs!;
      expect(device).toEqual({
        due: server.due.toISOString(),
        stability: server.stability,
        difficulty: server.difficulty,
        elapsedDays: server.elapsed_days,
        scheduledDays: server.scheduled_days,
        learningSteps: server.learning_steps,
        reps: server.reps,
        lapses: server.lapses,
        state: server.state,
        lastReview: server.last_review.toISOString(),
      });
    }
  });

  test('T015 AC7: offline, ladder generation shows the offline notice and queues no request', async ({ page, context, request }) => {
    const l = await learner(page, request);
    await addDueCard(l, 'only card', 5);
    await page.goto('/review');
    await waitForOfflineReady(page);
    await context.setOffline(true);
    await page.goto('/start?url=https%3A%2F%2Fgithub.com%2Fowner%2Fname');
    await expect(page.getByText(OFFLINE_NOTICE)).toBeVisible();
    await page.goto('/ladders');
    await expect(page.getByText(OFFLINE_NOTICE)).toBeVisible();
    await page.goto('/review');
    expect((await readStore(page, l.userId)).ratings).toHaveLength(0);
    await context.setOffline(false);
  });

  test('T015 AC1: the install prompt appears after the first completed session, not on first load', async ({ page, request }) => {
    const l = await learner(page, request);
    await addDueCard(l, 'install card', 5);
    await page.goto('/review');
    // Chromium may or may not send the event in headless mode: send one when the browser did not.
    await page.evaluate(() => window.dispatchEvent(Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt: () => Promise.resolve() })));
    await expect(page.getByText('install card', { exact: true })).toBeVisible();
    await expect(page.locator('#install-prompt')).toHaveCount(0);
    await rateGood(page);
    await expect(page.getByRole('heading', { name: 'Session finished' })).toBeVisible();
    const prompt = page.locator('#install-prompt');
    await expect(prompt).toBeVisible();
    await expect(prompt.getByRole('button')).toHaveText(['Install', 'Not now']);
    for (const v of viewports) {
      await page.setViewportSize({ width: v.width, height: v.height });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await page.setViewportSize({ width: 360, height: 740 });
    await page.screenshot({ path: 'e2e/screenshots/pwa-install-mobile.png' });
    await prompt.getByRole('button', { name: 'Not now' }).click();
    await expect(prompt).toHaveCount(0);
  });

  test('T015 AC4+5+6 and design: settings controls, export download, bad import file error, tokens and tap targets', async ({ page, request }) => {
    const l = await learner(page, request);
    const cardId = await addDueCard(l, 'export card', 5);
    await page.goto('/review');
    await rateGood(page);
    await expect(page.getByRole('heading', { name: 'Session finished' })).toBeVisible();
    await mockPush(page);
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    for (const name of ['Turn on reminders', 'Turn off reminders', 'Export progress', 'Import progress']) {
      await expect(page.getByRole('button', { name })).toBeVisible();
    }
    await expect(page.getByLabel('Reminder time (your local time)')).toBeVisible();
    // The server has VAPID keys: Turn on is usable, Turn off waits for a subscription.
    await expect(page.getByRole('button', { name: 'Turn on reminders' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Turn off reminders' })).toBeDisabled();

    // Export downloads one JSON file with the documented shape.
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export progress' }).click();
    const file = JSON.parse(await (await import('node:fs/promises')).readFile((await (await download).path())!, 'utf8'));
    expect(file).toMatchObject({ format: 'idea-ladder-progress', version: 1, learner: l.userId, levelStatus: [], evidenceHashes: [] });
    expect(file.cardStates.map((c: { cardId: string }) => c.cardId)).toEqual([cardId]);

    // A file that is not a progress file shows a clear error and writes nothing.
    const before = (await db.query('SELECT count(*) AS n FROM review_log WHERE user_id = $1', [l.userId])).rows[0].n;
    await page.getByLabel('Progress file (.json, up to 5 MB)').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"nope"}') });
    await page.getByRole('button', { name: 'Import progress' }).click();
    await expect(page.locator('#import-error')).toContainText('not a progress file from Idea Ladder');
    expect((await db.query('SELECT count(*) AS n FROM review_log WHERE user_id = $1', [l.userId])).rows[0].n).toBe(before);
    // The same exported file imports without change.
    await page.getByLabel('Progress file (.json, up to 5 MB)').setInputFiles({ name: 'progress.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
    await page.getByRole('button', { name: 'Import progress' }).click();
    await expect(page.locator('#import-status')).toContainText('0 card states updated, 0 review log rows added');

    // Design tokens, typography and tap targets.
    const style = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const probe = (value: string) => {
        const el = document.createElement('i');
        el.style.color = value;
        document.body.append(el);
        const c = getComputedStyle(el).color;
        el.remove();
        return c;
      };
      const button = document.getElementById('import-button')!;
      const primary = document.querySelector('form[action="/api/progress/export"] button')!;
      return {
        bodyFont: parseFloat(getComputedStyle(document.body).fontSize),
        primaryBg: getComputedStyle(primary).backgroundColor,
        accent: probe(root.getPropertyValue('--color-accent')),
        tap: [...document.querySelectorAll('button')].map((b) => ({ id: b.id, h: b.getBoundingClientRect().height })),
        quietColor: getComputedStyle(button).color,
      };
    });
    expect(style.bodyFont).toBeGreaterThanOrEqual(16);
    expect(style.primaryBg).toBe(style.accent);
    expect(style.quietColor).toBe(style.accent);
    for (const b of style.tap) expect(b.h).toBeGreaterThanOrEqual(44);
    for (const v of viewports) {
      await page.setViewportSize({ width: v.width, height: v.height });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: `e2e/screenshots/pwa-settings-${v.name}.png`, fullPage: true });
    }
    await page.getByLabel('Progress file (.json, up to 5 MB)').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('nope') });
    await page.getByRole('button', { name: 'Import progress' }).click();
    await expect(page.locator('#import-error')).toBeVisible();
    await page.setViewportSize({ width: 360, height: 740 });
    await page.screenshot({ path: 'e2e/screenshots/pwa-settings-error-mobile.png', fullPage: true });
  });

  test('T015 AC4: Turn on reminders stores the subscription with hour and timezone; Turn off deletes it (browser push mocked)', async ({ page, request }) => {
    const l = await learner(page, request);
    await mockPush(page);
    await page.goto('/settings');
    await page.getByLabel('Reminder time (your local time)').selectOption('7');
    await page.getByRole('button', { name: 'Turn on reminders' }).click();
    await expect(page.locator('#reminders-status')).toContainText('Reminders are on at 07:00');
    const rows = (await db.query('SELECT endpoint, reminder_hour, timezone FROM push_subscriptions WHERE user_id = $1', [l.userId])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reminder_hour: 7, timezone: await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone) });
    await expect(page.getByRole('button', { name: 'Turn off reminders' })).toBeEnabled();
    await page.getByRole('button', { name: 'Turn off reminders' }).click();
    await expect(page.locator('#reminders-status')).toHaveText('Reminders are off.');
    expect((await db.query('SELECT count(*) AS n FROM push_subscriptions WHERE user_id = $1', [l.userId])).rows[0].n).toBe('0');
  });

  test('T015 AC4: when the browser blocks notifications, the screen says so and nothing is requested again', async ({ page, request }) => {
    await learner(page, request);
    await page.context().clearPermissions();
    await page.goto('/settings');
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    const blocked = await page.evaluate(() => Notification.permission);
    test.skip(blocked !== 'denied', 'this browser starts with notifications not blocked');
    await expect(page.locator('#reminders-status')).toHaveText('Reminders blocked in browser settings');
    await expect(page.getByRole('button', { name: 'Turn on reminders' })).toBeDisabled();
  });

  test('T015 sign-out clears the device cache of the learner', async ({ page, request }) => {
    const l = await learner(page, request);
    await addDueCard(l, 'private card', 5);
    await page.goto('/review');
    await waitForOfflineReady(page);
    await expect.poll(async () => (await readStore(page, l.userId)).cards.length).toBe(1);
    await page.goto('/ladders');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('button', { name: 'Sign in with GitHub' })).toBeVisible();
    const left = await page.evaluate(async () => ({
      databases: (await indexedDB.databases()).map((d) => d.name).filter((n) => n?.startsWith('il-')),
      review: Boolean(await (await caches.open('il-pages-v1')).match('/review')),
    }));
    expect(left).toEqual({ databases: [], review: false });
  });
});
