// T016: the "This question seems wrong" button on the review card. POST /api/flags and the review API are mocked with
// page.route (contract: src/shared/flags.ts, src/shared/review.ts); the server side has its own bun tests.
import { expect, type Page, test } from "@playwright/test";
import type { ReviewCard, ReviewQueue } from "../src/shared/review.ts";

const VIEWPORTS = [
  { width: 360, height: 740 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
];
const SHOTS = "e2e/artifacts/T016";
const card = (id: string, front: string): ReviewCard => ({
  cardId: id,
  ladderId: "1",
  level: "L0",
  front,
  back: `Answer ${id}`,
  dueAt: "2026-11-12T07:00:00.000Z",
});
const CARDS = [card("201", "First question?"), card("202", "Second question?")];
const queue: ReviewQueue = {
  nowIso: "2026-11-12T08:00:00.000Z",
  sessionLimitMs: 300_000,
  hasCards: true,
  nextDueAt: null,
  cards: CARDS,
};

type FlagBody = { kind: string; id: string; reason?: string };
async function setup(page: Page, flagStatus: (n: number) => number = () => 200) {
  const flags: FlagBody[] = [];
  await page.route("**/api/review/queue", (route) => route.fulfill({ json: queue }));
  await page.route("**/api/flags", (route) => {
    const status = flagStatus(flags.length);
    flags.push(route.request().postDataJSON() as FlagBody);
    return route.fulfill(status === 200 ? { json: { ok: true } } : { status, body: JSON.stringify({ error: "x" }) });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in with GitHub" }).click();
  await expect(page).toHaveURL(/\/ladders$/);
  await page.goto("/review");
  await expect(page.locator(".review-front")).toHaveText("First question?");
  return flags;
}
const open = (page: Page) => page.getByRole("button", { name: "This question seems wrong", exact: true });

test("T016 flag: Send shows 'Flagged — thanks' and the next card, with the reason sent as text", async ({ page }) => {
  const flags = await setup(page);
  await open(page).click();
  await page.getByLabel("Reason (optional)").fill("<b>wrong</b> answer");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Flagged — thanks" })).toBeVisible();
  await expect(page.locator(".review-front")).toHaveText("Second question?");
  expect(flags).toEqual([{ kind: "card", id: "201", reason: "<b>wrong</b> answer" }]);
  expect(await page.locator(".flag-notice b").count()).toBe(0);
});

test("T016 flag: Cancel closes the confirmation and sends nothing", async ({ page }) => {
  const flags = await setup(page);
  await open(page).click();
  await expect(page.getByLabel("Reason (optional)")).toHaveAttribute("maxlength", "280");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(open(page)).toBeVisible();
  await expect(page.locator(".review-front")).toHaveText("First question?");
  expect(flags).toEqual([]);
});

test("T016 flag: an error shows a message and keeps the card; Send can be retried", async ({ page }) => {
  const flags = await setup(page, (n) => (n === 0 ? 503 : 200));
  await open(page).click();
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Try again in a moment" })).toBeVisible();
  await expect(page.locator(".review-front")).toHaveText("First question?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.locator(".review-front")).toHaveText("Second question?");
  expect(flags.length).toBe(2);
});

test("T016 flag: design checks, screenshots and no layout shift at 360 / 768 / 1280 px", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "Show answer" }).click();
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const btn = open(page);
    await expect(btn).toBeVisible();
    const m = await page.evaluate(() => {
      const b = document.querySelector(".flag-open") as HTMLElement;
      const cs = getComputedStyle(b);
      const probe = document.createElement("div");
      probe.style.color = "var(--color-text-muted)";
      document.body.appendChild(probe);
      const want = getComputedStyle(probe).color;
      probe.remove();
      const r = b.getBoundingClientRect();
      const ratings = [...document.querySelectorAll(".review-ratings button")].map((x) => x.getBoundingClientRect());
      const ratingsBottom = Math.max(...ratings.map((x) => x.bottom));
      const main = document.querySelector("main")?.getBoundingClientRect();
      return {
        fontSize: Number.parseFloat(cs.fontSize),
        font: cs.fontFamily,
        color: cs.color,
        want,
        w: r.width,
        h: r.height,
        gap: r.top - ratingsBottom,
        mainW: main?.width ?? 0,
        scrollWidth: document.documentElement.scrollWidth,
        ratingsTop: Math.min(...ratings.map((x) => x.top)),
      };
    });
    console.log(`T016 metrics ${vp.width}px ${JSON.stringify(m)}`);
    expect(m.fontSize).toBeGreaterThanOrEqual(14);
    expect(m.color).toBe(m.want);
    expect(m.h).toBeGreaterThanOrEqual(44);
    expect(m.w).toBeGreaterThanOrEqual(44);
    expect(m.gap).toBeGreaterThanOrEqual(16);
    expect(m.scrollWidth).toBeLessThanOrEqual(vp.width);
    if (vp.width === 360) expect(m.w).toBeGreaterThan(m.mainW - 40);
    else expect(m.w).toBeLessThan(m.mainW / 2);
    await page.screenshot({ path: `${SHOTS}/flag-button-${vp.width}.png`, fullPage: true });

    await btn.click();
    await expect(page.getByLabel("Reason (optional)")).toBeVisible();
    const after = await page.evaluate(() => ({
      top: Math.min(
        ...[...document.querySelectorAll(".review-ratings button")].map((x) => x.getBoundingClientRect().top),
      ),
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(after.top, "rating buttons do not move").toBe(m.ratingsTop);
    expect(after.scrollWidth).toBeLessThanOrEqual(vp.width);
    await page.screenshot({ path: `${SHOTS}/flag-confirm-${vp.width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Cancel" }).click();
  }
});
