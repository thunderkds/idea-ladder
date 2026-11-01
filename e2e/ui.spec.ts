import { expect, test, type Page } from '@playwright/test';

const STUB = 'http://127.0.0.1:4010';
const viewports = [
  { name: 'mobile', width: 360, height: 740 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 },
];

/** Resolve a CSS declaration with a token to the browser's computed value. */
async function expected(page: Page, prop: 'color' | 'backgroundColor' | 'fontFamily' | 'fontSize' | 'fontWeight' | 'padding', token: string) {
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

async function computed(page: Page, selector: string, prop: string) {
  return page.locator(selector).first().evaluate((el, p) => (getComputedStyle(el) as unknown as Record<string, string>)[p as string], prop);
}

for (const vp of viewports) {
  test(`layout at ${vp.name} ${vp.width}px: no horizontal scroll, screenshots`, async ({ page, request }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('/');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(vp.width);
    const btn = page.getByRole('button', { name: 'Sign in with GitHub' });
    const box = (await btn.boundingBox()) as { height: number; width: number };
    expect(box.height).toBeGreaterThanOrEqual(44);
    if (vp.name === 'mobile') expect(box.width).toBeGreaterThan(vp.width * 0.8);
    await page.screenshot({ path: `e2e/screenshots/home-${vp.name}.png` });

    await request.post(`${STUB}/__stub/user`, { data: { id: 42, login: 'octo' } });
    await btn.click();
    await expect(page.getByRole('heading', { name: 'My ladders' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(vp.width);
    if (vp.name === 'desktop') {
      const col = (await page.locator('main').boundingBox()) as { width: number };
      expect(col.width).toBeLessThanOrEqual(640 + 1);
    }
    await page.screenshot({ path: `e2e/screenshots/ladders-${vp.name}.png` });
  });
}

test('computed styles come from the tokens file', async ({ page }) => {
  await page.goto('/');
  expect(await computed(page, 'body', 'color')).toBe(await expected(page, 'color', '--color-text'));
  expect(await computed(page, 'body', 'backgroundColor')).toBe(await expected(page, 'backgroundColor', '--color-bg'));
  expect(await computed(page, 'body', 'fontFamily')).toBe(await expected(page, 'fontFamily', '--font-family-base'));
  expect(await computed(page, 'h1', 'fontSize')).toBe(await expected(page, 'fontSize', '--font-size-h1'));
  expect(await computed(page, 'h1', 'fontWeight')).toBe(await expected(page, 'fontWeight', '--font-weight-strong'));
  expect(await computed(page, 'body', 'fontSize')).toBe(await expected(page, 'fontSize', '--font-size-body'));
  expect(await computed(page, 'button', 'backgroundColor')).toBe(await expected(page, 'backgroundColor', '--color-accent'));
  expect(await computed(page, 'button', 'color')).toBe(await expected(page, 'color', '--color-accent-text'));
  expect(await computed(page, 'button', 'fontSize')).toBe(await expected(page, 'fontSize', '--font-size-body'));
  expect(await computed(page, 'button', 'fontWeight')).toBe(await expected(page, 'fontWeight', '--font-weight-strong'));
  // spacing: page container padding is --space-4 (top) / --space-3 (sides); button padding is --space-2 / --space-4
  const pageTop = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.paddingTop = 'var(--space-4)';
    probe.style.paddingLeft = 'var(--space-3)';
    document.body.appendChild(probe);
    const s = getComputedStyle(probe);
    const r = { top: s.paddingTop, left: s.paddingLeft };
    probe.remove();
    return r;
  });
  expect(await computed(page, 'main', 'paddingTop')).toBe(pageTop.top);
  expect(await computed(page, 'main', 'paddingLeft')).toBe(pageTop.left);
});
