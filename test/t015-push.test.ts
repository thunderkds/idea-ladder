import { InngestTestEngine } from '@inngest/test';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { isAllowedPushEndpoint } from '../src/push/subscriptions.js';
import { localHourAndDate, REMINDER_PAYLOAD, runReminders, type PushSender } from '../src/push/reminders.js';
import { createReminderTick } from '../src/workflow/reminders.js';
import { startTestApp, type TestApp } from './helpers/app.js';
import { days, minutes, postJson, scenario, type Scenario } from './helpers/review-scenario.js';

const T0 = new Date('2026-11-01T09:00:00Z');
const ENDPOINT = (n: string) => `https://fcm.googleapis.com/fcm/send/${n}`;

describe('T015 local hour (unit)', () => {
  it('gives the learner local hour and date in an IANA timezone', () => {
    expect(localHourAndDate(T0, 'UTC')).toEqual({ hour: 9, date: '2026-11-01' });
    expect(localHourAndDate(T0, 'Asia/Ho_Chi_Minh')).toEqual({ hour: 16, date: '2026-11-01' });
    expect(localHourAndDate(new Date('2026-11-01T01:30:00Z'), 'America/New_York')).toEqual({ hour: 21, date: '2026-10-31' });
    expect(localHourAndDate(new Date('2026-11-01T00:00:00Z'), 'UTC').hour).toBe(0);
  });
  it('accepts only https endpoints of known push services', () => {
    expect(isAllowedPushEndpoint(ENDPOINT('x'))).toBe(true);
    expect(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true);
    expect(isAllowedPushEndpoint('https://web.push.apple.com/x')).toBe(true);
    for (const bad of ['https:fcm.googleapis.com/x', 'https:/fcm.googleapis.com/x', 'http://fcm.googleapis.com/x', 'https://127.0.0.1/x', 'https://localhost/x', 'https://evil.example/fcm.googleapis.com', 'https://fcm.googleapis.com.evil.example/x', 'https://u:p@fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'nope']) {
      expect(isAllowedPushEndpoint(bad)).toBe(false);
    }
  });
});

describe('T015 VAPID configuration (unit)', () => {
  const base = { DATABASE_URL: 'postgres://u:p@localhost/db', GITHUB_CLIENT_ID: 'c', GITHUB_CLIENT_SECRET: 's', SESSION_SECRET: 'x'.repeat(40) };
  it('is off without keys, on with all three, and an error with only some', () => {
    expect(loadConfig(base).vapid).toBeUndefined();
    expect(loadConfig({ ...base, VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:a@b.example' }).vapid).toEqual({ publicKey: 'pub', privateKey: 'priv', subject: 'mailto:a@b.example' });
    expect(() => loadConfig({ ...base, VAPID_PUBLIC_KEY: 'pub' })).toThrow(/VAPID_PRIVATE_KEY, VAPID_SUBJECT/);
    expect(() => loadConfig({ ...base, VAPID_PUBLIC_KEY: 'p', VAPID_PRIVATE_KEY: 'q', VAPID_SUBJECT: 'ftp://x' })).toThrow(/VAPID_SUBJECT/);
  });
});

describe('T015 push subscriptions and reminders (integration)', () => {
  let t: TestApp;
  let clock = T0;
  let sent: Array<{ endpoint: string; payload: string }>;
  let failWith: Record<string, number>;
  const send: PushSender = async (target, payload) => {
    const status = failWith[target.endpoint];
    if (status) throw Object.assign(new Error(`push service answered ${status}`), { statusCode: status });
    sent.push({ endpoint: target.endpoint, payload });
  };

  beforeAll(async () => {
    t = await startTestApp({ now: () => clock, readPassed: async () => [], pushSender: send });
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    clock = T0;
    sent = [];
    failWith = {};
    await t.pool.query('DELETE FROM push_subscriptions');
  });

  const body = (endpoint: string, over: Record<string, unknown> = {}) => ({ subscription: { endpoint, keys: { p256dh: 'p'.repeat(20), auth: 'a'.repeat(10) } }, reminderHour: 9, timezone: 'UTC', ...over });
  const subscribe = (s: Scenario | undefined, b: unknown) => postJson(t, '/api/push/subscribe', s?.cookie, b);
  const subs = async () => (await t.pool.query('SELECT * FROM push_subscriptions ORDER BY endpoint')).rows;
  async function dueLearner(endpoint: string, over: Record<string, unknown> = {}, dueCards = 2) {
    const s = await scenario(t);
    for (let i = 0; i < dueCards; i++) await s.seedDue(await s.card('L0'), minutes(T0, -30 - i));
    expect((await subscribe(s, body(endpoint, over))).status).toBe(200);
    return s;
  }

  it('AC4: Turn on stores one subscription with hour and timezone; turning on again updates it; Turn off deletes it', async () => {
    const s = await scenario(t);
    expect((await subscribe(s, body(ENDPOINT('one')))).status).toBe(200);
    expect((await subscribe(s, body(ENDPOINT('one'), { reminderHour: 7, timezone: 'Asia/Ho_Chi_Minh' }))).status).toBe(200);
    expect(await subs()).toHaveLength(1);
    expect((await subs())[0]).toMatchObject({ user_id: s.userId, endpoint: ENDPOINT('one'), reminder_hour: 7, timezone: 'Asia/Ho_Chi_Minh' });
    const other = await scenario(t);
    await postJson(t, '/api/push/unsubscribe', other.cookie, { endpoint: ENDPOINT('one') });
    expect(await subs()).toHaveLength(1); // another learner cannot delete it
    expect((await postJson(t, '/api/push/unsubscribe', s.cookie, { endpoint: ENDPOINT('one') })).status).toBe(200);
    expect(await subs()).toHaveLength(0);
  });

  it('AC4 negative: no session, wrong content type, bad endpoint, hour or timezone are refused and store nothing', async () => {
    const s = await scenario(t);
    expect((await subscribe(undefined, body(ENDPOINT('x')))).status).toBe(401);
    expect((await postJson(t, '/api/push/subscribe', s.cookie, body(ENDPOINT('x')), { 'content-type': 'text/plain' })).status).toBe(415);
    for (const bad of [body('https://127.0.0.1/x'), body('http://fcm.googleapis.com/x'), body(ENDPOINT('x'), { reminderHour: 24 }), body(ENDPOINT('x'), { reminderHour: 1.5 }), body(ENDPOINT('x'), { timezone: 'Mars/Base' }), {}, 'nope']) {
      expect((await subscribe(s, bad)).status).toBe(400);
    }
    expect((await postJson(t, '/api/push/unsubscribe', s.cookie, {})).status).toBe(400);
    expect(await subs()).toHaveLength(0);
  });

  it('AC4: at the learner hour with 2 due cards one push is sent; the same hour again sends nothing more', async () => {
    await dueLearner(ENDPOINT('due'));
    const run = await runReminders(t.pool, send, T0, { readPassed: async () => [] });
    expect(run).toEqual({ sent: 1, removed: 0, noneDue: 0, failed: 0 });
    expect(sent).toEqual([{ endpoint: ENDPOINT('due'), payload: REMINDER_PAYLOAD }]);
    expect((await subs())[0].last_sent_on).toBeTruthy();
    await runReminders(t.pool, send, minutes(T0, 20), { readPassed: async () => [] });
    expect(sent).toHaveLength(1);
    // The next local day sends again.
    await runReminders(t.pool, send, days(T0, 1), { readPassed: async () => [] });
    expect(sent).toHaveLength(2);
  });

  it('AC4: with 0 due cards no push is sent; other hours send nothing; the timezone is the learner own', async () => {
    const empty = await scenario(t);
    await subscribe(empty, body(ENDPOINT('empty')));
    await dueLearner(ENDPOINT('wrong-hour'), { reminderHour: 10 });
    await dueLearner(ENDPOINT('hcm'), { reminderHour: 16, timezone: 'Asia/Ho_Chi_Minh' });
    const run = await runReminders(t.pool, send, T0, { readPassed: async () => [] });
    expect(run).toMatchObject({ sent: 1, noneDue: 1 });
    expect(sent.map((p) => p.endpoint)).toEqual([ENDPOINT('hcm')]);
  });

  it('AC4: a subscription the push service answers 404 or 410 is deleted; another error keeps it and retries next tick', async () => {
    await dueLearner(ENDPOINT('gone-410'));
    await dueLearner(ENDPOINT('gone-404'));
    await dueLearner(ENDPOINT('flaky'));
    failWith = { [ENDPOINT('gone-410')]: 410, [ENDPOINT('gone-404')]: 404, [ENDPOINT('flaky')]: 503 };
    const run = await runReminders(t.pool, send, T0, { readPassed: async () => [] });
    expect(run).toEqual({ sent: 0, removed: 2, noneDue: 0, failed: 1 });
    const left = await subs();
    expect(left.map((r) => r.endpoint)).toEqual([ENDPOINT('flaky')]);
    expect(left[0].last_sent_on).toBeNull();
  });

  it('AC4: the Inngest hourly function (cron) runs the same send', async () => {
    await dueLearner(ENDPOINT('cron'));
    const fn = createReminderTick(t.pool, send, { now: () => T0, readPassed: async () => [] });
    const { result } = await new InngestTestEngine({ function: fn }).execute();
    expect(result).toMatchObject({ sent: 1 });
    expect(sent.map((p) => p.endpoint)).toEqual([ENDPOINT('cron')]);
    const off = await new InngestTestEngine({ function: createReminderTick(t.pool, undefined) }).execute();
    expect(off.result).toEqual({ skipped: 'push-not-configured' });
  });
});

describe('T015 PWA assets and pages (integration)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  const pngSize = (file: string) => {
    const b = readFileSync(file);
    return [b.readUInt32BE(16), b.readUInt32BE(20), b.subarray(1, 4).toString()];
  };

  it('AC1: the manifest is valid, installable and uses the theme primary colour', async () => {
    const res = await t.app.request('/manifest.webmanifest');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/manifest\+json|application\/json/);
    const m = (await res.json()) as { name: string; display: string; start_url: string; theme_color: string; icons: Array<{ src: string; sizes: string; type: string }> };
    expect(m).toMatchObject({ name: 'Idea Ladder', display: 'standalone', start_url: '/review' });
    const accent = /--color-accent:\s*(#[0-9a-f]{6})/i.exec(readFileSync('public/tokens.css', 'utf8'))![1];
    expect(m.theme_color.toLowerCase()).toBe(accent!.toLowerCase());
    expect(m.icons.map((i) => i.sizes).sort()).toEqual(['192x192', '512x512']);
    for (const icon of m.icons) {
      expect((await t.app.request(icon.src)).status).toBe(200);
      const size = Number(icon.sizes.split('x')[0]);
      expect(pngSize(`public/${icon.src.replace('/assets/', '')}`)).toEqual([size, size, 'PNG']);
    }
  });

  it('AC1: the service worker is served at the root with no-cache, and every file it precaches exists', async () => {
    const res = await t.app.request('/sw.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/javascript/);
    expect(res.headers.get('cache-control')).toBe('no-cache');
    const source = await res.text();
    const list = /var PRECACHE = \[([^\]]*)\]/.exec(source)![1]!;
    const urls = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
    expect(urls.length).toBeGreaterThan(8);
    for (const url of urls) expect([url, (await t.app.request(url)).status]).toEqual([url, 200]);
  });

  it('AC7: the offline page says what needs a connection; pages link the manifest and register the worker', async () => {
    const offline = await (await t.app.request('/offline')).text();
    expect(offline).toContain('You are offline — this needs a connection');
    const home = await (await t.app.request('/')).text();
    expect(home).toContain('rel="manifest"');
    expect(home).toContain('/assets/pwa.js');
    expect(readFileSync('public/pwa.js', 'utf8')).toContain("navigator.serviceWorker.register('/sw.js')");
  });

  it('AC4/5/6: the settings page has the four controls, needs a session and never carries the private key', async () => {
    const cookie = await t.signIn(777);
    expect((await t.app.request('/settings', { redirect: 'manual' })).status).toBe(302);
    const page = await (await t.app.request('/settings', { headers: { cookie } })).text();
    for (const label of ['Turn on reminders', 'Turn off reminders', 'Export progress', 'Import progress']) expect(page).toContain(label);
    expect(page).toContain('id="reminder-hour"');
    expect(page).not.toMatch(/data-vapid-public-key="[^"]/); // not configured in this app: the key attribute is empty
    const review = await (await t.app.request('/review', { headers: { cookie } })).text();
    expect(review).toMatch(/data-learner-id="[0-9a-f-]{36}"/);
  });
});
