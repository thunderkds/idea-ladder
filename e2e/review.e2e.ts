// T011 review screen: one card at a time, Show answer, Again/Hard/Good/Easy, 5:00 session cap, empty and end states,
// rating retry with one idempotency key. The review API is mocked with page.route (contract: src/shared/review.ts), so
// these tests check the client only; the server side has its own bun tests. Time is controlled with page.clock.
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import type { RateRequest, RateResponse, ReviewCard, ReviewQueue } from "../src/shared/review.ts";

const VIEWPORTS = [
  { name: "mobile", width: 360, height: 740 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 800 },
];
const START = new Date("2026-11-12T08:00:00Z");
const CARDS: ReviewCard[] = [
  {
    cardId: "101",
    ladderId: "1",
    level: "L0",
    front: "Why does a page rendered on the server show content before its JavaScript has loaded?",
    back: "The server sends finished HTML, so the browser can paint it at once; scripts only add behaviour later.",
    dueAt: "2026-11-12T07:00:00.000Z",
  },
  {
    cardId: "102",
    ladderId: "1",
    level: "L0",
    front: "What does a cache key built from a repo and a commit SHA guarantee?",
    back: "The same commit always maps to the same entry, so a change in the repo can never reuse a stale result.",
    dueAt: "2026-11-12T07:10:00.000Z",
  },
  {
    cardId: "103",
    ladderId: "1",
    level: "L1",
    front: "Third question",
    back: "Third answer",
    dueAt: "2026-11-12T07:20:00Z",
  },
  {
    cardId: "104",
    ladderId: "2",
    level: "L0",
    front: "Fourth question",
    back: "Fourth answer",
    dueAt: "2026-11-12T07:30:00Z",
  },
];
const queueOf = (cards: ReviewCard[], extra: Partial<ReviewQueue> = {}): ReviewQueue => ({
  nowIso: START.toISOString(),
  sessionLimitMs: 300_000,
  hasCards: true,
  nextDueAt: null,
  cards,
  ...extra,
});

type Mock = { queueCalls: number; rated: RateRequest[] };
/**
 * Mocks GET /api/review/queue and POST /api/review/rate. `rateStatus(n)` gives the status of the n-th rate call
 * (0-based); every 200 answers with a RateResponse.
 */
async function mockReview(page: Page, queue: ReviewQueue | number, rateStatus: (n: number) => number = () => 200) {
  const mock: Mock = { queueCalls: 0, rated: [] };
  await page.route("**/api/review/queue", (route) => {
    mock.queueCalls++;
    return typeof queue === "number"
      ? route.fulfill({ status: queue, body: "{}" })
      : route.fulfill({ json: queue, headers: { "cache-control": "no-store" } });
  });
  await page.route("**/api/review/rate", (route) => {
    const body = route.request().postDataJSON() as RateRequest;
    const status = rateStatus(mock.rated.length);
    mock.rated.push(body);
    if (status !== 200) return route.fulfill({ status, body: "{}" });
    const json: RateResponse = {
      cardId: body.cardId,
      dueAt: "2026-11-13T08:00:00.000Z",
      state: "learning",
      duplicate: false,
    };
    return route.fulfill({ json });
  });
  return mock;
}

/** Signs in through the GitHub stub, then opens /review. */
async function openReview(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in with GitHub" }).click();
  await expect(page).toHaveURL(/\/ladders$/);
  await page.goto("/review");
}

const timer = (page: Page) => page.getByRole("timer");
const ratingButtons = (page: Page) => page.locator(".review-ratings button");
const question = (page: Page) => page.locator(".review-front");

/** Screenshots go to test-results/screenshots (git-ignored); the committed copies are e2e/baseline/review-*.png. */
async function shootAll(page: Page, label: string) {
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.screenshot({ path: `test-results/screenshots/review-${label}-${vp.name}.png`, fullPage: true });
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

function collectConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

/** Each rating button's box at the current viewport. */
const buttonBoxes = (page: Page) =>
  ratingButtons(page).evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    }),
  );

test("T011 AC 4: card front first, answer hidden until Show answer, then Again/Hard/Good/Easy and a 5:00 timer", async ({
  page,
}) => {
  await page.clock.install({ time: START });
  const mock = await mockReview(page, queueOf(CARDS.slice(0, 2)));
  const errors = collectConsoleErrors(page);
  await openReview(page);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Review");
  await expect(page.locator(".review-card")).toHaveCount(1);
  await expect(question(page)).toHaveText(CARDS[0]?.front ?? "");
  await expect(page.getByText(CARDS[0]?.back ?? "")).toHaveCount(0);
  await expect(ratingButtons(page)).toHaveCount(0);
  await expect(timer(page)).toHaveText("5:00");
  await expect(page.getByText("Card 1 of 2")).toBeVisible();

  await expectTokens(page, [
    ["body", "background-color", "--color-bg"],
    ["body", "color", "--color-text"],
    ["body", "font-family", "--font-family"],
    [".review-card", "background-color", "--color-surface"],
    [".review-card", "border-top-color", "--color-border"],
    [".review-front", "color", "--color-text"],
    [".review-front", "font-size", "--font-size-body"],
    [".review-front", "font-family", "--font-family"],
    [".review-level", "color", "--color-text-muted"],
    [".review-timer", "color", "--color-text"],
    [".review-timer .muted", "color", "--color-text-muted"],
    [".review-show", "background-color", "--color-accent"],
    [".review-show", "color", "--color-accent-text"],
    ["h1", "font-size", "--font-size-h1"],
    ["main", "max-width", "--content-max"],
  ]);
  await expectNoSeriousAxeViolations(page);
  await shootAll(page, "front");

  await page.getByRole("button", { name: "Show answer" }).click();
  await expect(page.getByText(CARDS[0]?.back ?? "")).toBeVisible();
  await expect(page.getByRole("button", { name: "Show answer" })).toHaveCount(0);
  await expect(ratingButtons(page)).toHaveText(["Again", "Hard", "Good", "Easy"]);
  await expect(page.getByRole("group", { name: "Rate this card" })).toBeVisible();
  await expectTokens(page, [
    [".review-ratings .button", "background-color", "--color-surface"],
    [".review-ratings .button", "color", "--color-text"],
    [".review-ratings .button", "border-top-color", "--color-border"],
    [".review-ratings .button", "font-size", "--font-size-body"],
    [".review-ratings .button", "font-family", "--font-family"],
    [".review-ratings", "column-gap", "--space-2"],
  ]);
  const fontPx = await page
    .locator(".review-back .long-text")
    .evaluate((e) => Number.parseFloat(getComputedStyle(e).fontSize));
  expect(fontPx, "answer body text >= 16px").toBeGreaterThanOrEqual(16);

  // Tap targets and gaps at every viewport; one row at 768 and 1280, one row or 2 x 2 at 360.
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const boxes = await buttonBoxes(page);
    expect(boxes).toHaveLength(4);
    for (const b of boxes) {
      expect(b.width, `${vp.name}: button width >= 44`).toBeGreaterThanOrEqual(44);
      expect(b.height, `${vp.name}: button height >= 44`).toBeGreaterThanOrEqual(44);
    }
    const tops = new Set(boxes.map((b) => Math.round(b.top)));
    if (vp.width >= 768) expect(tops.size, `${vp.name}: buttons in one row`).toBe(1);
    else expect([1, 2], `${vp.name}: one row or 2 x 2`).toContain(tops.size);
    for (let i = 1; i < boxes.length; i++) {
      const [a, b] = [boxes[i - 1], boxes[i]];
      if (a && b && Math.round(a.top) === Math.round(b.top)) {
        expect(b.left - a.right, `${vp.name}: gap between buttons >= 8`).toBeGreaterThanOrEqual(8);
      }
    }
    if (vp.width >= 768) {
      const main = await page.locator("main").evaluate((e) => {
        const r = e.getBoundingClientRect();
        return { left: r.left, right: window.innerWidth - r.right, width: r.width };
      });
      expect(Math.abs(main.left - main.right), `${vp.name}: card centred`).toBeLessThanOrEqual(1);
      expect(main.width, `${vp.name}: max width kept`).toBeLessThan(vp.width);
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await expectNoSeriousAxeViolations(page);
  await shootAll(page, "back");

  await page.clock.fastForward(4_000);
  await page.getByRole("button", { name: "Good" }).click();
  await expect(question(page)).toHaveText(CARDS[1]?.front ?? "");
  expect(mock.rated).toHaveLength(1);
  expect(mock.rated[0]).toMatchObject({ cardId: "101", rating: "good" });
  expect(mock.rated[0]?.elapsedMs).toBeGreaterThanOrEqual(4_000);
  expect(mock.rated[0]?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page.getByText("Card 2 of 2")).toBeVisible();
  await page.getByRole("button", { name: "Show answer" }).click();
  await page.getByRole("button", { name: "Easy" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Session done");
  await expect(page.getByText("You rated 2 cards this session.")).toBeVisible();
  expect(mock.rated.map((r) => r.rating)).toEqual(["good", "easy"]);
  expect(mock.rated[1]?.idempotencyKey).not.toBe(mock.rated[0]?.idempotencyKey);
  expect(mock.queueCalls).toBe(1);
  expect(errors).toEqual([]);
});

test("T011 keyboard: Space shows the answer and keys 1-4 rate Again/Hard/Good/Easy", async ({ page }) => {
  const mock = await mockReview(page, queueOf(CARDS));
  await openReview(page);
  await expect(question(page)).toHaveText(CARDS[0]?.front ?? "");
  for (const [n, key] of ["1", "2", "3", "4"].entries()) {
    await expect(question(page)).toHaveText(CARDS[n]?.front ?? "");
    // Before the answer is shown, a rating key does nothing.
    await page.keyboard.press(key);
    await page.keyboard.press("Space");
    await expect(page.getByText(CARDS[n]?.back ?? "")).toBeVisible();
    await page.keyboard.press(key);
    await expect.poll(() => mock.rated.length).toBe(n + 1);
  }
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Session done");
  expect(mock.rated.map((r) => [r.cardId, r.rating])).toEqual([
    ["101", "again"],
    ["102", "hard"],
    ["103", "good"],
    ["104", "easy"],
  ]);
});

test("T011 SC 4: at 4:59 the shown card stays; at 5:01 it can be rated, no next card, session-end screen", async ({
  page,
}) => {
  await page.clock.install({ time: START });
  const mock = await mockReview(page, queueOf(CARDS.slice(0, 2)));
  const errors = collectConsoleErrors(page);
  await openReview(page);
  await expect(question(page)).toHaveText(CARDS[0]?.front ?? "");
  const live = page.locator("[aria-live=polite]");
  await expect(live).toHaveText("");

  await page.clock.fastForward("04:00");
  await expect(timer(page)).toHaveText("1:00");
  await expect(live).toHaveText("1 minute left");
  await page.clock.fastForward("00:59");
  await expect(timer(page)).toHaveText("0:01");
  await expect(live).toHaveText("10 seconds left");
  await expect(question(page)).toHaveText(CARDS[0]?.front ?? "");

  await page.clock.fastForward("00:02");
  await expect(timer(page)).toHaveText("0:00");
  await expect(live).toHaveText("Time is up. Rate this card to finish.");
  // The card on screen at 5:00 can still be shown and rated.
  await expect(question(page)).toHaveText(CARDS[0]?.front ?? "");
  await page.getByRole("button", { name: "Show answer" }).click();
  await page.getByRole("button", { name: "Hard" }).click();

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Session done");
  await expect(page.getByText(CARDS[1]?.front ?? "")).toHaveCount(0);
  await expect(page.getByText("You rated 1 card this session.")).toBeVisible();
  await expect(page.getByText("Unrated cards stay due for the next session.")).toBeVisible();
  expect(mock.rated.map((r) => r.cardId)).toEqual(["101"]);
  expect(errors).toEqual([]);
  await expectNoSeriousAxeViolations(page);
  await shootAll(page, "session-end");
});

test.describe("T011 AC 5 empty queue", () => {
  test.use({ timezoneId: "UTC", locale: "en-US" });

  test("T011 AC 5: nothing due shows the next due time in local time, one queue request, no error", async ({
    page,
  }) => {
    const mock = await mockReview(page, queueOf([], { nextDueAt: "2026-11-13T09:00:00.000Z" }));
    const errors = collectConsoleErrors(page);
    await openReview(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Nothing due");
    await expect(page.getByText("Next review: Nov 13, 2026, 9:00 AM")).toBeVisible();
    await expect(page.locator("time")).toHaveAttribute("datetime", "2026-11-13T09:00:00.000Z");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(timer(page)).toHaveCount(0);
    await page.waitForTimeout(1_500);
    expect(mock.queueCalls).toBe(1);
    expect(errors).toEqual([]);
    await expectNoSeriousAxeViolations(page);
    await shootAll(page, "empty");
  });

  test("T011 AC 5: a learner with no cards sees No cards yet, not Nothing due", async ({ page }) => {
    const mock = await mockReview(page, queueOf([], { hasCards: false }));
    await openReview(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("No cards yet");
    await expect(page.getByText("Nothing due")).toHaveCount(0);
    await page.waitForTimeout(1_000);
    expect(mock.queueCalls).toBe(1);
    await expectNoSeriousAxeViolations(page);
    await shootAll(page, "no-cards");
  });
});

test.describe("T011 AC 5 local time in UTC+14", () => {
  test.use({ timezoneId: "Pacific/Kiritimati", locale: "en-US" });

  test("T011 AC 5: the next due time is shown in the learner's local time (UTC+14)", async ({ page }) => {
    await mockReview(page, queueOf([], { nextDueAt: "2026-11-13T09:00:00.000Z" }));
    await openReview(page);
    await expect(page.getByText("Next review: Nov 13, 2026, 11:00 PM")).toBeVisible();
  });
});

test("T011 AC 6: a server error keeps the card with Try again; the retry reuses the same idempotency key", async ({
  page,
}) => {
  const mock = await mockReview(page, queueOf(CARDS.slice(0, 2)), (n) => (n === 0 ? 500 : 200));
  await openReview(page);
  await page.getByRole("button", { name: "Show answer" }).click();
  await page.getByRole("button", { name: "Good" }).click();

  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Could not save your rating");
  await expect(question(page)).toHaveText(CARDS[0]?.front ?? "");
  await expect(page.getByText(CARDS[0]?.back ?? "")).toBeVisible();
  await expect(ratingButtons(page)).toHaveCount(4);
  await expectNoSeriousAxeViolations(page);
  await page.screenshot({ path: "test-results/screenshots/review-rate-error-desktop.png", fullPage: true });

  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(question(page)).toHaveText(CARDS[1]?.front ?? "");
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(mock.rated).toHaveLength(2);
  expect(mock.rated[1]?.idempotencyKey).toBe(mock.rated[0]?.idempotencyKey);
  expect(mock.rated[1]).toMatchObject({ cardId: "101", rating: "good" });

  // The next card gets its own key.
  await page.getByRole("button", { name: "Show answer" }).click();
  await page.keyboard.press("4");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Session done");
  expect(mock.rated[2]?.idempotencyKey).not.toBe(mock.rated[0]?.idempotencyKey);
  await expect(page.getByText("You rated 2 cards this session.")).toBeVisible();
});

test("T011 401: a signed-out rating or queue request sends the learner to /", async ({ page }) => {
  await mockReview(page, queueOf(CARDS.slice(0, 1)), () => 401);
  await openReview(page);
  await page.getByRole("button", { name: "Show answer" }).click();
  const toHome = page.waitForRequest((req) => req.isNavigationRequest() && new URL(req.url()).pathname === "/");
  await page.getByRole("button", { name: "Again" }).click();
  await toHome;
  await expect(page).not.toHaveURL(/\/review$/);

  await page.unrouteAll();
  await mockReview(page, 401);
  const again = page.waitForRequest((req) => req.isNavigationRequest() && new URL(req.url()).pathname === "/");
  await page.goto("/review");
  await again;
  await expect(page).not.toHaveURL(/\/review$/);
});

test("T011: a failed queue load shows an alert with Try again, not Loading forever", async ({ page }) => {
  await mockReview(page, 500);
  await openReview(page);
  await expect(page.getByRole("alert")).toContainText("Could not load your review");
  await expect(page.getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/review");
  await expect(page.locator("[aria-busy=true]")).toHaveCount(0);
  await expectNoSeriousAxeViolations(page);
});

test("T011: Start review links to /review from My ladders rows and from the ladder view", async ({ page }) => {
  const control = "http://localhost:54402";
  const { next } = (await (await page.request.get(`${control}/ladders`)).json()) as Record<string, string>;
  await page.request.get(`${control}/set-user?id=43&login=reader`);
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "Sign in with GitHub" }).click();
    await expect(page).toHaveURL(/\/ladders$/);
    const rows = page.locator(".ladder-row");
    await expect(rows).toHaveCount(2);
    for (const row of await rows.all()) {
      await expect(row.getByRole("link", { name: "Start review", exact: true })).toHaveAttribute("href", "/review");
    }
    await expectNoSeriousAxeViolations(page);
    await page.goto(`/ladders/${next}`);
    await expect(page.getByRole("link", { name: "Start review", exact: true })).toHaveAttribute("href", "/review");
    await expectNoSeriousAxeViolations(page);
  } finally {
    await page.request.get(`${control}/set-user?id=42&login=octo`);
  }
});

test.describe("T011 real server (no mocks)", () => {
  test.use({ timezoneId: "UTC", locale: "en-US" });
  const CONTROL = "http://localhost:54402";
  type Seeds = { reviewer: { githubId: number; login: string }; waiter: { githubId: number; login: string } };

  test("T011 end to end: due L0 cards only, ratings saved, then Nothing due; waiter and octo empty states", async ({
    page,
  }) => {
    const seeds = (await (await page.request.get(`${CONTROL}/review-seeds`)).json()) as Seeds;
    await page.request.get(`${CONTROL}/reset-review`);
    const as = async (who: { githubId: number; login: string }) => {
      await page.context().clearCookies();
      await page.request.get(`${CONTROL}/set-user?id=${who.githubId}&login=${who.login}`);
      await openReview(page);
    };
    try {
      await as(seeds.reviewer);
      await expect(page.getByText("Card 1 of 3")).toBeVisible();
      const fronts: string[] = [];
      for (let n = 0; n < 3; n++) {
        fronts.push((await question(page).textContent()) ?? "");
        await page.keyboard.press("Space");
        await page.keyboard.press("3");
        if (n < 2) await expect(page.getByText(`Card ${n + 2} of 3`)).toBeVisible();
      }
      expect(fronts.join("|")).not.toContain("Locked card");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Session done");
      await expect(page.getByText("You rated 3 cards this session.")).toBeVisible();
      // The ratings are stored: a new visit has nothing due now (Good on a New card is due again in minutes).
      await page.goto("/review");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Nothing due");
      await expect(page.getByText(/^Next review: /)).toBeVisible();

      await as(seeds.waiter);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Nothing due");
      await expect(page.getByText("Next review: Jan 2, 2030, 9:00 AM")).toBeVisible();

      await as({ githubId: 42, login: "octo" });
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("No cards yet");
    } finally {
      await page.request.get(`${CONTROL}/set-user?id=42&login=octo`);
      await page.request.get(`${CONTROL}/reset-review`);
    }
  });
});
