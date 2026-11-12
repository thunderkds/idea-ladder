import { expect, type Page, test } from "@playwright/test";

const VIEWPORTS = [
  { name: "mobile", width: 360, height: 740 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 800 },
];

/** Screenshots go to test-results/screenshots (git-ignored); the committed baseline is e2e/baseline/. */
async function shootAll(page: Page, label: string) {
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.screenshot({ path: `test-results/screenshots/${label}-${vp.name}.png`, fullPage: true });
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, `${label} at ${vp.width}px has no horizontal scroll`).toBeLessThanOrEqual(vp.width);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
}

/** Asserts each element's computed style equals the value a tokens.css custom property resolves to. */
async function expectTokens(page: Page, checks: [selector: string, property: string, token: string][]) {
  const results = await page.evaluate((list) => {
    return list.map(([selector, property, token]) => {
      const el = document.querySelector(selector);
      const probe = document.createElement("div");
      document.body.appendChild(probe);
      probe.style.setProperty(property, `var(${token})`);
      const want = getComputedStyle(probe).getPropertyValue(property);
      probe.remove();
      const got = el ? getComputedStyle(el).getPropertyValue(property) : "missing element";
      return { selector, property, token, want, got };
    });
  }, checks);
  for (const r of results) expect(r.got, `${r.selector} ${r.property} = ${r.token}`).toBe(r.want);
}

test("sign-in tracer: GitHub sign-in lands on an empty My ladders page", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Idea Ladder" })).toBeVisible();
  const button = page.getByRole("button", { name: "Sign in with GitHub" });
  await expect(button).toBeVisible();

  await expectTokens(page, [
    ["body", "color", "--color-text"],
    ["body", "background-color", "--color-bg"],
    ["body", "font-family", "--font-family"],
    ["body", "font-size", "--font-size-body"],
    ["h1", "font-size", "--font-size-h1"],
    ["h1", "font-weight", "--font-weight-strong"],
    ["button", "background-color", "--color-accent"],
    ["button", "color", "--color-accent-text"],
    ["button", "font-size", "--font-size-body"],
    ["button", "font-weight", "--font-weight-strong"],
    ["button", "padding-left", "--space-6"],
    ["main", "padding-top", "--space-8"],
    ["main", "padding-left", "--space-4"],
  ]);
  await shootAll(page, "home");
  await page.setViewportSize({ width: 360, height: 740 });
  const box = await button.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  await page.setViewportSize({ width: 1280, height: 800 });

  await button.click();
  await expect(page).toHaveURL(/\/ladders$/);
  await expect(page.getByRole("heading", { name: "My ladders" })).toBeVisible();
  await expect(page.getByText("No ladders yet")).toBeVisible();
  await expect(page.getByText("@octo")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expectTokens(page, [
    ["h1", "font-size", "--font-size-h1"],
    [".empty", "background-color", "--color-surface"],
    [".empty", "padding-top", "--space-8"],
  ]);
  await shootAll(page, "ladders");
});

test("sign-out: the old session no longer opens My ladders", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in with GitHub" }).click();
  await expect(page.getByRole("heading", { name: "My ladders" })).toBeVisible();
  const [session] = (await page.context().cookies()).filter((c) => c.name === "il_session");
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe("Lax");

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: "Sign in with GitHub" })).toBeVisible();

  // Replay the old cookie: the server must refuse it.
  if (session) await page.context().addCookies([session]);
  const res = await page.request.get("/ladders", { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  expect(res.headers().location).toBe("/");
});

test("signed out, /ladders redirects to /", async ({ page }) => {
  const res = await page.request.get("/ladders", { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  await page.goto("/ladders");
  await expect(page).toHaveURL(/\/$/);
});
