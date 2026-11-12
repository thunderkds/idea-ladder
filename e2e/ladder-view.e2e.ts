// T010 ladder view: L0-L4 with lock state, Unverified badge, pinned SHA, link-outs to README and DeepWiki, My ladders.
// Seeds live in e2e/serve.ts; its control port (APP_PORT + 1) gives the seeded ids and switches the stubbed GitHub user.
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const CONTROL = "http://localhost:54402";
const SHA = "6b41670516ed8e8b738612f60491995470aa63b3";
const VIEWPORTS = [
  { name: "mobile", width: 360, height: 740 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 800 },
];

/** Screenshots go to test-results/screenshots (git-ignored). */
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

async function expectNoSeriousAxeViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  const bad = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

const seededIds = async (page: Page) =>
  (await (await page.request.get(`${CONTROL}/ladders`)).json()) as Record<"next" | "klona" | "plain", string>;
async function signIn(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in with GitHub" }).click();
  await expect(page).toHaveURL(/\/ladders$/);
}
const levels = (page: Page) => page.locator(".levels > li");

test("SC 4: seeded ladder shows 5 levels L0-L4, Unverified badge, SHA 6b41670 and the two link-outs", async ({
  page,
}) => {
  const { next } = await seededIds(page);
  await signIn(page);
  await page.goto(`/ladders/${next}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("vercel/next.js");
  await expect(levels(page)).toHaveCount(5);
  await expect(page.locator(".level-id")).toHaveText(["L0", "L1", "L2", "L3", "L4"]);
  await expect(page.locator(".level-title")).toHaveText([
    "Prerequisites",
    "Run it",
    "Modify",
    "Understand",
    "Rebuild or contribute",
  ]);
  await expect(page.getByText("Clone the repo and run it")).toBeVisible();
  await expect(page.getByText("Branch or diff link + questions generated from your diff")).toBeVisible();

  const badge = page.locator(".badge");
  await expect(badge).toHaveText("Unverified");
  await expect(page.locator("#status-description")).toHaveText("AI-drafted, not yet reviewed by people");
  await expect(badge).toHaveAccessibleDescription("AI-drafted, not yet reviewed by people");
  await expect(page.getByText("Pinned to")).toContainText("6b41670");
  await expect(page.locator("body")).not.toContainText(SHA);

  const readme = page.getByRole("link", { name: "Read the README" });
  await expect(readme).toHaveAttribute("href", `https://github.com/vercel/next.js/blob/${SHA}/README.md`);
  const wiki = page.getByRole("link", { name: "Open in DeepWiki" });
  await expect(wiki).toHaveAttribute("href", "https://deepwiki.com/vercel/next.js");
  for (const link of [readme, wiki]) {
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  }

  // No passes: L0 open, L1-L4 locked with the lock text, not links, aria-disabled.
  await expect(levels(page).nth(0)).toHaveClass(/level-open/);
  for (const n of [1, 2, 3, 4]) {
    const li = levels(page).nth(n);
    await expect(li).toHaveClass(/level-locked/);
    await expect(li).toHaveAttribute("aria-disabled", "true");
    await expect(li).toContainText(`Locked — pass L${n - 1} first`);
    await expect(li.locator("a")).toHaveCount(0);
    await expect(li.locator("svg.icon")).toHaveCount(1);
  }

  await expectTokens(page, [
    ["body", "background-color", "--color-bg"],
    [".level-open", "border-top-color", "--color-accent"],
    [".level-open", "background-color", "--color-surface"],
    [".level-locked", "background-color", "--color-bg"],
    [".level-locked", "color", "--color-text-muted"],
    [".badge", "background-color", "--color-surface"],
    [".badge", "border-top-color", "--color-border"],
    [".badge", "font-size", "--font-size-small"],
    [".badge", "font-weight", "--font-weight-strong"],
    [".badge", "font-family", "--font-family"],
    [".level-title", "font-size", "--font-size-body"],
    [".level-title", "font-weight", "--font-weight-strong"],
    [".level-title", "font-family", "--font-family"],
    [".level-goal", "font-size", "--font-size-body"],
    [".level-goal", "font-weight", "--font-weight-body"],
    [".levels", "gap", "--space-4"],
    [".level", "padding-top", "--space-4"],
    [".level", "padding-left", "--space-4"],
    [".ladder-links", "gap", "--space-3"],
    ["h1", "font-size", "--font-size-h1"],
    ["main", "max-width", "--content-max"],
  ]);
  await expectNoSeriousAxeViolations(page);
  await shootAll(page, "ladder-view-no-passes");
});

test("SC 5: keyboard reaches the open level; locked levels have nothing to focus and announce aria-disabled", async ({
  page,
}) => {
  const { next } = await seededIds(page);
  await signIn(page);
  await page.goto(`/ladders/${next}`);
  await expect(levels(page)).toHaveCount(5);
  const focusedText: string[] = [];
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    focusedText.push(
      await page.evaluate(
        () => (document.activeElement?.tagName === "A" ? document.activeElement.textContent : "") ?? "",
      ),
    );
  }
  expect(focusedText).toContain("Prerequisites");
  // Nothing inside a locked level can take focus.
  expect(focusedText.join("|")).not.toMatch(/Run it|Modify|Understand|Rebuild/);
  await expect(page.locator(".level-locked a, .level-locked button, .level-locked [tabindex]")).toHaveCount(0);
  await expect(page.locator('.level[aria-disabled="true"]')).toHaveCount(4);
  await expectNoSeriousAxeViolations(page);
});

test("L0 and L1 passed: L2 open, L3 and L4 locked; a very long goal wraps at 360px", async ({ page }) => {
  const { klona } = await seededIds(page);
  await signIn(page);
  await page.goto(`/ladders/${klona}`);
  await expect(levels(page)).toHaveCount(5);
  await expect(levels(page).nth(0)).toHaveClass(/level-passed/);
  await expect(levels(page).nth(1)).toHaveClass(/level-passed/);
  await expect(levels(page).nth(2)).toHaveClass(/level-open/);
  await expect(levels(page).nth(3)).toHaveClass(/level-locked/);
  await expect(levels(page).nth(4)).toHaveClass(/level-locked/);
  await expect(levels(page).nth(3)).toContainText("Locked — pass L2 first");
  await expect(levels(page).nth(0)).toContainText("Passed");
  await expect(page.getByRole("link", { name: "Read the README" })).toHaveAttribute(
    "href",
    "https://github.com/lukeed/klona/blob/2f3c9d1e8a7b4c5d6e7f8091a2b3c4d5e6f70812/README.md",
  );
  await expectTokens(page, [
    [".level-passed", "background-color", "--color-surface"],
    [".level-passed", "border-top-color", "--color-border"],
  ]);
  await expectNoSeriousAxeViolations(page);
  await shootAll(page, "ladder-view-passed");
  await page.setViewportSize({ width: 360, height: 740 });
  const buttons = await page
    .locator(".ladder-links .button")
    .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
  const main = await page.locator("main").evaluate((e) => e.getBoundingClientRect().width);
  for (const w of buttons) expect(w, "link-out buttons are full width on mobile").toBeGreaterThan(main - 40);
});

test("SC 7: a ladder with no level rows shows five levels with `Not generated yet`", async ({ page }) => {
  const { plain } = await seededIds(page);
  await signIn(page);
  await page.goto(`/ladders/${plain}`);
  await expect(levels(page)).toHaveCount(5);
  await expect(page.getByText("Not generated yet")).toHaveCount(5);
  await expect(page.locator(".level-title")).toHaveText([
    "Prerequisites",
    "Run it",
    "Modify",
    "Understand",
    "Rebuild or contribute",
  ]);
  await expect(page.getByText("Repo link or PR link")).toBeVisible();
  await expectNoSeriousAxeViolations(page);
  await shootAll(page, "ladder-view-fallback");
});

test("SC 6: an unknown ladder id shows the 404 page", async ({ page }) => {
  await signIn(page);
  const res = await page.goto("/ladders/does-not-exist");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ladder not found");
  const missing = await page.goto("/ladders/987654");
  expect(missing?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ladder not found");
  await expectNoSeriousAxeViolations(page);
});

test("AC 6: signed out, a ladder URL goes to sign-in and back to the same ladder", async ({ page, request }) => {
  const { next } = await seededIds(page);
  await page.goto(`/ladders/${next}`);
  await expect(page).toHaveURL(new RegExp(`/ladders/${next}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("vercel/next.js");
  const api = await page.context().request.get(`/api/ladders/${next}`);
  expect(api.headers()["cache-control"]).toBe("no-store");
  // Signed out API call: 401 (the `request` fixture has no session cookie).
  const out = await request.get(`/api/ladders/${next}`);
  expect(out.status()).toBe(401);
});

test("AC 7: My ladders lists the saved ladders the learner started, each with Open ladder", async ({ page }) => {
  const { next, klona } = await seededIds(page);
  await page.request.get(`${CONTROL}/set-user?id=43&login=reader`);
  try {
    await signIn(page);
    await expect(page.getByText("No ladders yet")).toHaveCount(0);
    await expect(page.locator(".ladder-row")).toHaveCount(2);
    await expect(page.getByRole("link", { name: /^Open ladder/ })).toHaveCount(2);
    await expect(page.getByRole("link", { name: "Open ladder vercel/next.js" })).toHaveAttribute(
      "href",
      `/ladders/${next}`,
    );
    await expect(page.getByRole("link", { name: "Open ladder lukeed/klona" })).toHaveAttribute(
      "href",
      `/ladders/${klona}`,
    );
    await expectTokens(page, [
      [".ladder-row", "background-color", "--color-surface"],
      [".ladder-row", "padding-top", "--space-4"],
      [".ladder-list", "gap", "--space-4"],
    ]);
    await expectNoSeriousAxeViolations(page);
    await shootAll(page, "ladders-two");
    await page.getByRole("link", { name: "Open ladder lukeed/klona" }).click();
    await expect(page).toHaveURL(new RegExp(`/ladders/${klona}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("lukeed/klona");
  } finally {
    await page.request.get(`${CONTROL}/set-user?id=42&login=octo`);
  }
});

test("a failed ladder request shows `Could not load this ladder` with a retry link, not Loading forever", async ({
  page,
}) => {
  const { next } = await seededIds(page);
  await signIn(page);
  await page.route("**/api/ladders/*", (route) => route.fulfill({ status: 500, body: "boom" }));
  await page.goto(`/ladders/${next}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Could not load this ladder");
  await expect(page.getByRole("link", { name: "Try again" })).toHaveAttribute("href", `/ladders/${next}`);
  await expect(page.locator("[aria-busy=true]")).toHaveCount(0);
  await expectNoSeriousAxeViolations(page);
  await page.unroute("**/api/ladders/*");
  await page.getByRole("link", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("vercel/next.js");
});
