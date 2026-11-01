import { chromium, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A browser is installable only outside incognito and with install UI. The default test context is incognito and the default
// headless shell has no install UI, so this test starts the full Chromium (headless mode) with a profile folder.
test('T015 AC1: manifest, active service worker, installable, beforeinstallprompt fires', async ({ request, baseURL }) => {
  const profile = await mkdtemp(join(tmpdir(), 'il-pwa-'));
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, baseURL });
  try {
    await run(context, request);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});

async function run(context: Awaited<ReturnType<typeof chromium.launchPersistentContext>>, request: import('@playwright/test').APIRequestContext) {
  const page = await context.newPage();
  await page.addInitScript(() => {
    (window as unknown as { __bip: boolean }).__bip = false;
    window.addEventListener('beforeinstallprompt', () => ((window as unknown as { __bip: boolean }).__bip = true));
  });
  const githubId = 100_000 + Math.floor(Math.random() * 800_000);
  await request.post('http://127.0.0.1:4010/__stub/user', { data: { id: githubId, login: `inst${githubId}` } });
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in with GitHub' }).click();
  await expect(page.getByRole('heading', { name: 'My ladders' })).toBeVisible();
  await page.goto('/review');
  expect(await page.evaluate(() => navigator.serviceWorker.ready.then((r) => r.active?.state))).toBe('activated');

  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifest = await (await page.request.get(manifestHref!)).json();
  expect(manifest).toMatchObject({ display: 'standalone', start_url: '/review' });
  expect(manifest.icons.map((i: { sizes: string }) => i.sizes).sort()).toEqual(['192x192', '512x512']);
  const tokenAccent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim());
  expect(manifest.theme_color.toLowerCase()).toBe(tokenAccent.toLowerCase());

  const cdp = await context.newCDPSession(page);
  await cdp.send('Page.enable');
  const { installabilityErrors } = (await cdp.send('Page.getInstallabilityErrors')) as { installabilityErrors: unknown[] };
  expect(installabilityErrors).toEqual([]);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __bip: boolean }).__bip), { timeout: 20_000 }).toBe(true);
}
