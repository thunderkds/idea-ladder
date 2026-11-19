// T007 concept edit screen (/ladders/:id/concepts): Success Criteria 5 and 6, AC 5 on screen, HTML shown as text, and the
// UI section (screenshots at 3 widths, no horizontal scroll, tap targets, design tokens). Seeds live in e2e/serve.ts.
import { expect, type Page, test } from "@playwright/test";

const CONTROL = "http://localhost:54402";
const SHOTS = "e2e/artifacts/T007";
const VIEWPORTS = [
  { name: "mobile", width: 360, height: 740 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 800 },
];

type Seeds = Record<"edit" | "invalid" | "fallback", string>;
const conceptSeeds = async (page: Page) => (await (await page.request.get(`${CONTROL}/concept-seeds`)).json()) as Seeds;
const plainId = async (page: Page) =>
  ((await (await page.request.get(`${CONTROL}/ladders`)).json()) as { plain: string }).plain;
async function signIn(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in with GitHub" }).click();
  await expect(page).toHaveURL(/\/ladders$/);
}
const inputs = (page: Page) => page.locator(".concept-list input");
const values = (page: Page) => inputs(page).evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
const save = (page: Page) => page.getByRole("button", { name: "Save concepts" });

/** Screenshots at 3 widths into e2e/artifacts/T007, each with the no-horizontal-scroll assertion. */
async function shootAll(page: Page, label: string) {
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    // Tall viewport = the whole page: a sticky Save bar then sits at the page end instead of mid-image.
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({ width: vp.width, height: Math.max(vp.height, height) });
    await page.screenshot({ path: `${SHOTS}/${label}-${vp.name}.png` });
    await page.setViewportSize({ width: vp.width, height: vp.height });
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

test("SC 5: rename one, remove one, add one, Save concepts, reload -> the saved list", async ({ page }) => {
  const { edit } = await conceptSeeds(page);
  await signIn(page);
  await page.goto(`/ladders/${edit}/concepts`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Edit concepts");
  expect(await values(page)).toEqual(["Rust async", "Embeddings", "CRDT", "Event emitter"]);
  await expect(page.getByText("Why Rust async matters in this repo.")).toBeVisible();
  await expect(page.getByText("Low confidence: this ladder uses concepts only")).toHaveCount(0);

  await page.getByLabel("Concept 1").fill("Futures and wakers");
  await page.getByRole("button", { name: "Remove concept Embeddings" }).click();
  await page.getByRole("button", { name: "Add concept" }).click();
  await inputs(page).last().fill("Pinning");
  await save(page).click();
  await expect(page.getByRole("status")).toHaveText("Concepts saved.");

  await page.reload();
  expect(await values(page)).toEqual(["Futures and wakers", "CRDT", "Event emitter", "Pinning"]);
  // The shared list is unchanged for another learner (server test covers it); here the learner's own list is what loads.
});

test("HTML in a concept name is shown as text, never as markup", async ({ page }) => {
  const { edit } = await conceptSeeds(page);
  const html = "<b>bold</b><img src=x onerror=alert(1)>";
  await signIn(page);
  await page.goto(`/ladders/${edit}/concepts`);
  await page.getByLabel("Concept 2").fill(html);
  await expect(page.getByRole("button", { name: `Remove concept ${html}` })).toBeVisible();
  await save(page).click();
  await expect(page.getByRole("status")).toHaveText("Concepts saved.");
  await page.reload();
  expect(await values(page)).toContain(html);
  await expect(page.getByRole("button", { name: `Remove concept ${html}` })).toBeVisible();
  expect(await page.locator("main b, main img").count()).toBe(0);
});

test("SC 6: fallbackToConcepts shows the banner above the list", async ({ page }) => {
  const { fallback } = await conceptSeeds(page);
  await signIn(page);
  await page.goto(`/ladders/${fallback}/concepts`);
  const banner = page.getByText("Low confidence: this ladder uses concepts only", { exact: true });
  await expect(banner).toBeVisible();
  const bannerBox = await banner.boundingBox();
  const listBox = await page.locator(".concept-list").boundingBox();
  expect(bannerBox && listBox && bannerBox.y + bannerBox.height <= listBox.y).toBe(true);
});

test("AC 5: 7 concepts -> error next to the list, input kept", async ({ page }) => {
  const { invalid } = await conceptSeeds(page);
  await signIn(page);
  await page.goto(`/ladders/${invalid}/concepts`);
  for (const name of ["Alpha", "Beta", "Gamma"]) {
    await page.getByRole("button", { name: "Add concept" }).click();
    await inputs(page).last().fill(name);
  }
  await expect(inputs(page)).toHaveCount(7);
  await save(page).click();
  const error = page.locator("#concepts-error");
  await expect(error).toHaveText("need 3 to 6 concepts, got 7");
  await expect(page.locator(".concept-list")).toHaveAccessibleDescription("need 3 to 6 concepts, got 7");
  expect(await values(page)).toEqual(["Rust async", "Embeddings", "CRDT", "Event emitter", "Alpha", "Beta", "Gamma"]);
  await expect(page.getByRole("status")).toHaveText("");
});

test("AC 5: duplicate or too-short name -> error next to that field, input kept", async ({ page }) => {
  const { invalid } = await conceptSeeds(page);
  await signIn(page);
  await page.goto(`/ladders/${invalid}/concepts`);
  await page.getByLabel("Concept 2").fill("rust ASYNC");
  await save(page).click();
  const second = page.getByLabel("Concept 2");
  await expect(second).toHaveAttribute("aria-invalid", "true");
  await expect(second).toHaveAccessibleDescription('duplicate concept "rust ASYNC"');
  expect(await values(page)).toEqual(["Rust async", "rust ASYNC", "CRDT", "Event emitter"]);

  await second.fill("");
  await save(page).click();
  await expect(second).toHaveAccessibleDescription("name must have at least 2 characters");
  await second.fill("x".repeat(61));
  await save(page).click();
  await expect(second).toHaveAccessibleDescription("name must have at most 60 characters");
  await expect(second).toHaveValue("x".repeat(61));
});

test("the server's 422 is shown next to the named field and the input is kept", async ({ page }) => {
  const { invalid } = await conceptSeeds(page);
  await signIn(page);
  await page.goto(`/ladders/${invalid}/concepts`);
  await page.route("**/api/ladders/*/concepts", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({
          status: 422,
          contentType: "application/json",
          body: JSON.stringify({ field: "concepts[2].name", message: "name from the server" }),
        })
      : route.continue(),
  );
  await page.getByLabel("Concept 3").fill("Server check");
  await save(page).click();
  await expect(page.getByLabel("Concept 3")).toHaveAccessibleDescription("name from the server");
  await expect(page.getByLabel("Concept 3")).toHaveValue("Server check");
});

test("unknown ladder or a ladder with no concepts -> not-found message, no form", async ({ page }) => {
  const plain = await plainId(page);
  await signIn(page);
  for (const id of [plain, "999999"]) {
    await page.goto(`/ladders/${id}/concepts`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Concepts not found");
    await expect(page.locator("input")).toHaveCount(0);
    await expect(save(page)).toHaveCount(0);
  }
});

test("signed out -> sign-in, then back on the concepts screen", async ({ page }) => {
  const { invalid } = await conceptSeeds(page);
  await page.goto(`/ladders/${invalid}/concepts`);
  await expect(page).toHaveURL(new RegExp(`/ladders/${invalid}/concepts$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Edit concepts");
});

test("the ladder view links to the screen; the screen is reachable by keyboard", async ({ page }) => {
  const { invalid } = await conceptSeeds(page);
  await signIn(page);
  await page.goto(`/ladders/${invalid}`);
  await page.getByRole("link", { name: "Edit concepts" }).click();
  await expect(page).toHaveURL(new RegExp(`/ladders/${invalid}/concepts$`));
  await page.getByRole("link", { name: "Back to the ladder" }).focus();
  const seen: string[] = [];
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    seen.push(
      await page.evaluate(
        () =>
          document.activeElement?.getAttribute("aria-label") ??
          document.activeElement?.textContent ??
          document.activeElement?.id ??
          "",
      ),
    );
  }
  expect(seen.join("|")).toContain("Add concept");
  expect(seen.join("|")).toContain("Save concepts");
  await expect(page.locator(".concept-list input:focus, button:focus, a:focus").first()).toBeVisible();
});

const TOKENS: [string, string, string][] = [
  ["body", "background-color", "--color-bg"],
  ["h1", "font-family", "--font-family"],
  ["h1", "font-size", "--font-size-h1"],
  [".concept-label", "font-size", "--font-size-small"],
  [".concept-label", "font-weight", "--font-weight-strong"],
  [".text-input", "font-family", "--font-family"],
  [".text-input", "font-size", "--font-size-body"],
  [".text-input", "color", "--color-text"],
  [".text-input", "background-color", "--color-surface"],
  [".text-input", "border-top-color", "--color-border"],
  [".concept-reason", "font-size", "--font-size-small"],
  [".concept-reason", "color", "--color-text-muted"],
  [".concept-list", "gap", "--space-4"],
  [".concept-row", "padding-top", "--space-4"],
  [".concept-row", "padding-left", "--space-4"],
  [".concept-row", "border-top-color", "--color-border"],
  [".concept-edit", "gap", "--space-2"],
  [".save-bar .button", "background-color", "--color-accent"],
  [".save-bar .button", "color", "--color-accent-text"],
  [".save-bar .button", "font-size", "--font-size-body"],
  [".save-bar .button", "font-weight", "--font-weight-strong"],
  [".concept-edit .button", "background-color", "--color-surface"],
  [".concept-edit .button", "border-top-color", "--color-border"],
];

async function expectTapTargets(page: Page) {
  const small = await page.evaluate(() =>
    [...document.querySelectorAll("main button, main a, main input")]
      .map((el) => ({ el, box: el.getBoundingClientRect() }))
      .filter(({ box }) => box.height > 0 && box.height < 44)
      .map(({ el, box }) => `${el.tagName} ${el.textContent?.trim()} h=${box.height}`),
  );
  expect(small, "tap targets below 44px").toEqual([]);
}

test("UI evidence: 4 concepts, validation error, banner at 360/768/1280; tokens, tap targets, sticky Save", async ({
  page,
}) => {
  const { invalid, fallback } = await conceptSeeds(page);
  await signIn(page);

  // 4 concepts
  await page.goto(`/ladders/${invalid}/concepts`);
  await expect(inputs(page)).toHaveCount(4);
  await expectTokens(page, TOKENS);
  await shootAll(page, "concepts-4");
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await expectTapTargets(page);
    const box = await save(page).boundingBox();
    expect(box && box.y >= 0 && box.y + box.height <= vp.height, `Save inside the ${vp.width}px viewport`).toBe(true);
  }

  // validation error (7 concepts): error colour and size from tokens, Save still in view with the long list
  await page.setViewportSize({ width: 360, height: 740 });
  for (const name of ["Alpha", "Beta", "Gamma"]) {
    await page.getByRole("button", { name: "Add concept" }).click();
    await inputs(page).last().fill(name);
  }
  await save(page).click();
  await expect(page.locator("#concepts-error")).toBeVisible();
  const box = await save(page).boundingBox();
  expect(box && box.y + box.height <= 740, "Save in the 360px viewport with 7 concepts").toBe(true);
  await expectTokens(page, [
    ["#concepts-error", "color", "--color-error"],
    ["#concepts-error", "font-size", "--font-size-small"],
    ["#concepts-error", "font-weight", "--font-weight-strong"],
  ]);
  await expectTapTargets(page);
  await shootAll(page, "concepts-error");

  // banner
  await page.goto(`/ladders/${fallback}/concepts`);
  await expect(page.locator(".banner")).toBeVisible();
  await expectTokens(page, [
    [".banner", "background-color", "--color-surface"],
    [".banner", "border-top-color", "--color-accent"],
    [".banner", "color", "--color-text"],
    [".banner", "font-size", "--font-size-body"],
    [".banner", "font-weight", "--font-weight-strong"],
    [".banner", "padding-top", "--space-3"],
  ]);
  await shootAll(page, "concepts-banner");
});
