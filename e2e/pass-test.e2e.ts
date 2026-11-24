// T030: pass-test screens. The T012-T014 handlers are mocked with page.route (contracts: src/server/mcq-test.ts,
// src/server/artifacts.ts, the T014 guide); the last test runs against the real T012 handlers and the seeded e2e database.
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type Route, test } from "@playwright/test";
import type { LadderView, LevelView } from "../src/server/ladder-view.ts";
import type { McqAttempt, McqResult } from "../src/server/mcq-test.ts";
import { FIXED_LEVELS, LEVEL_IDS, type LevelLock } from "../src/shared/levels.ts";

const CONTROL = "http://localhost:54402";
const SHOTS = "e2e/artifacts/T030";
const VIEWPORTS = [
  { width: 360, height: 740 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
];

const ladderView = (locks: LevelLock[]): LadderView => ({
  repoFullName: "vercel/next.js",
  commitSha: "6b41670516ed8e8b738612f60491995470aa63b3",
  status: "unverified",
  levels: LEVEL_IDS.map(
    (id, i): LevelView => ({
      id,
      title: FIXED_LEVELS[id].title,
      goal: `Goal of ${id}`,
      passTest: FIXED_LEVELS[id].passTest,
      lock: locks[i] ?? "locked",
    }),
  ),
});
/** L0-L2 passed, L3 open: the MCQ level under test. */
const L3_OPEN = ladderView(["passed", "passed", "passed", "open", "locked"]);

const LONG =
  `${"A very long option text that has to wrap on a small phone screen without scrolling. ".repeat(5)}`.slice(0, 480);
const attempt = (count = 10, startedAt = new Date()): McqAttempt => ({
  attemptId: "900",
  ladderId: "1",
  level: "L3",
  startedAt: startedAt.toISOString(),
  expiresAt: new Date(startedAt.getTime() + 30 * 60_000).toISOString(),
  questions: Array.from({ length: count }, (_, i) => ({
    id: String(500 + i),
    question: i === 0 ? `Which call starts the loop? ${LONG}` : `Question ${i + 1}?`,
    options: [`Option ${i + 1}a`, `Option ${i + 1}b`, i === 0 ? LONG : `Option ${i + 1}c`, `Option ${i + 1}d`],
  })),
});
const passResult: McqResult = {
  attemptId: "900",
  asked: 10,
  correct: 9,
  pass: true,
  unlockedLevel: "L4",
  evidence: null,
  reviewCardIds: [],
};
const failResult: McqResult = {
  ...passResult,
  correct: 7,
  pass: false,
  unlockedLevel: null,
  reviewCardIds: ["31", "32", "33"],
};

type Mocks = {
  ladder?: LadderView | (() => LadderView);
  start?: (route: Route) => Promise<void>;
  submit?: (route: Route) => Promise<void>;
};
type Calls = { starts: number; submits: unknown[] };

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in with GitHub" }).click();
  await expect(page).toHaveURL(/\/ladders$/);
}
const seededIds = async (page: Page) =>
  (await (await page.request.get(`${CONTROL}/ladders`)).json()) as Record<"next" | "klona" | "plain", string>;

/** Signs in, mocks the handlers and opens the test screen of `level` on the seeded next.js ladder. */
async function openTest(page: Page, level: string, mocks: Mocks = {}): Promise<{ calls: Calls; ladderId: string }> {
  const calls: Calls = { starts: 0, submits: [] };
  const { next } = await seededIds(page);
  await signIn(page);
  await page.route(`**/api/ladders/${next}`, (route) =>
    route.fulfill({ json: typeof mocks.ladder === "function" ? mocks.ladder() : (mocks.ladder ?? L3_OPEN) }),
  );
  await page.route("**/api/ladders/*/levels/*/mcq-attempts", async (route) => {
    calls.starts += 1;
    if (mocks.start) return mocks.start(route);
    return route.fulfill({ json: attempt() });
  });
  await page.route("**/api/mcq-attempts/*/submit", async (route) => {
    calls.submits.push(route.request().postDataJSON());
    if (mocks.submit) return mocks.submit(route);
    return route.fulfill({ json: passResult });
  });
  await page.goto(`/ladders/${next}?test=${level}`);
  return { calls, ladderId: next };
}

const takeTest = (page: Page) => page.getByRole("button", { name: "Take the test", exact: true });
const submit = (page: Page) => page.getByRole("button", { name: "Submit answers" });
/** Chooses option `n` (0-3) of every question, the first `count` questions only. */
async function answer(page: Page, count: number, n = 0) {
  const groups = page.locator("fieldset.question");
  for (let i = 0; i < count; i++) await groups.nth(i).getByRole("radio").nth(n).check();
}

async function expectNoSeriousAxeViolations(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  const bad = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${label} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

test("T030 entry: an open, not-passed level shows `Take the test`; passed and locked levels do not", async ({
  page,
}) => {
  const { next } = await seededIds(page);
  await signIn(page);
  await page.route(`**/api/ladders/${next}`, (route) => route.fulfill({ json: L3_OPEN }));
  await page.goto(`/ladders/${next}`);
  const levels = page.locator(".levels > li");
  await expect(levels).toHaveCount(5);
  for (const n of [0, 1, 2, 4]) await expect(levels.nth(n).getByRole("link", { name: /Take the test/ })).toHaveCount(0);
  const link = levels.nth(3).getByRole("link", { name: /Take the test/ });
  await expect(link).toHaveAttribute("href", `/ladders/${next}?test=L3`);
  await link.click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("L3 Understand");
});

test("T030 SC 1: 10 questions in server order; submit disabled until all answered; a double click sends 1 request", async ({
  page,
}) => {
  const { calls } = await openTest(page, "L3");
  await expect(page.locator("fieldset.question")).toHaveCount(0);
  await takeTest(page).click();
  const groups = page.locator("fieldset.question");
  await expect(groups).toHaveCount(10);
  expect(calls.starts).toBe(1);
  // Server order: questions and options exactly as sent.
  const sent = attempt();
  await expect(groups.locator("legend")).toHaveText(
    sent.questions.map((q, i) => new RegExp(`${i + 1}\\. ${q.question.slice(0, 20)}`)),
  );
  await expect(groups.nth(1).locator("label")).toHaveText(sent.questions[1]?.options ?? []);

  await answer(page, 9);
  await expect(submit(page)).toBeDisabled();
  await expect(page.getByText("9 of 10 answered")).toBeVisible();
  await groups.nth(9).getByRole("radio").nth(2).check();
  await expect(submit(page)).toBeEnabled();
  await submit(page).dblclick();
  await expect(page.getByText("Level passed")).toBeVisible();
  expect(calls.submits).toHaveLength(1);
  // Answers are option indexes in the shown order, keyed by question id.
  expect(calls.submits[0]).toEqual({
    answers: { ...Object.fromEntries(sent.questions.map((q) => [q.id, 0])), "509": 2 },
  });
});

test("T030 AC 1: no answer key reaches the page or the client state", async ({ page }) => {
  // Even if a server bug sent a key, the client keeps only id, question and options.
  await openTest(page, "L3", {
    start: (route) =>
      route.fulfill({
        json: { ...attempt(), questions: attempt().questions.map((q) => ({ ...q, key: "SECRET-KEY" })) },
      }),
  });
  await takeTest(page).click();
  await expect(page.locator("fieldset.question")).toHaveCount(10);
  expect(await page.content()).not.toContain("SECRET-KEY");
  // The real T012 response carries no key field at any depth (asserted against the real handler in the last test).
});

test("T030 SC 2: a pass shows `Level passed` and a link to the next level, now unlocked", async ({ page }) => {
  let passed = false;
  const after = ladderView(["passed", "passed", "passed", "passed", "open"]);
  const { ladderId } = await openTest(page, "L3", {
    ladder: () => (passed ? after : L3_OPEN),
    submit: async (route) => {
      passed = true;
      await route.fulfill({ json: passResult });
    },
  });
  await takeTest(page).click();
  await answer(page, 10);
  await submit(page).click();
  const result = page.locator("[aria-live=polite]").filter({ hasText: "Level passed" });
  await expect(result).toBeVisible();
  await expect(result).toContainText("9 of 10");
  const next = page.getByRole("link", { name: "Go to L4 Rebuild or contribute" });
  await expect(next).toHaveAttribute("href", `/ladders/${ladderId}#level-L4`);
  await expectNoSeriousAxeViolations(page, "result-pass");
  await next.click();
  await expect(page.locator("#level-L4")).toHaveClass(/level-open/);
  await expect(page.locator("#level-L3")).toHaveClass(/level-passed/);
});

test("T030 SC 3: a fail shows `7 of 10` and `Review these cards` opens review with those 3 cards", async ({ page }) => {
  await openTest(page, "L3", { submit: (route) => route.fulfill({ json: failResult }) });
  await takeTest(page).click();
  await answer(page, 10);
  await submit(page).click();
  const result = page.locator("[aria-live=polite]").filter({ hasText: "7 of 10" });
  await expect(result).toBeVisible();
  await expect(result).toContainText("Not passed yet");
  await expectNoSeriousAxeViolations(page, "result-fail");
  const review = page.getByRole("link", { name: "Review these cards" });
  await expect(review).toHaveAttribute("href", "/review?cards=31,32,33");

  const card = (id: string) => ({
    cardId: id,
    ladderId: "1",
    level: "L3",
    front: `Card ${id}?`,
    back: `Back ${id}`,
    dueAt: "2026-11-12T07:00:00.000Z",
  });
  await page.route("**/api/review/queue", (route) =>
    route.fulfill({
      json: {
        nowIso: "2026-11-24T08:00:00.000Z",
        sessionLimitMs: 300_000,
        hasCards: true,
        nextDueAt: null,
        cards: ["30", "31", "32", "33", "34"].map(card),
      },
    }),
  );
  await review.click();
  await expect(page.getByText("Card 1 of 3")).toBeVisible();
  await expect(page.locator(".review-front")).toHaveText("Card 31?");
});

test("T030 SC 7: a locked level has no `Take the test`; its direct URL shows `Pass the previous level first`", async ({
  page,
}) => {
  const { calls } = await openTest(page, "L4");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pass the previous level first");
  await expect(takeTest(page)).toHaveCount(0);
  expect(calls.starts).toBe(0);
  await expectNoSeriousAxeViolations(page, "locked");
});
