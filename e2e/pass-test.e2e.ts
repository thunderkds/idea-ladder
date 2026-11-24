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
  artifact?: (route: Route) => Promise<void>;
};
type Calls = { starts: number; submits: unknown[]; artifacts: unknown[] };

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in with GitHub" }).click();
  await expect(page).toHaveURL(/\/ladders$/);
}
const seededIds = async (page: Page) =>
  (await (await page.request.get(`${CONTROL}/ladders`)).json()) as Record<"next" | "klona" | "plain", string>;

/** Signs in, mocks the handlers and opens the test screen of `level` on the seeded next.js ladder. */
async function openTest(page: Page, level: string, mocks: Mocks = {}): Promise<{ calls: Calls; ladderId: string }> {
  const calls: Calls = { starts: 0, submits: [], artifacts: [] };
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
  await page.route("**/api/ladders/*/levels/*/artifact", async (route) => {
    calls.artifacts.push(route.request().postDataJSON());
    if (mocks.artifact) return mocks.artifact(route);
    return route.fulfill({ status: 500, json: { error: "unmocked" } });
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

const L1_OPEN = ladderView(["passed", "open", "locked", "locked", "locked"]);
const L2_OPEN = ladderView(["passed", "passed", "open", "locked", "locked"]);
const L4_OPEN = ladderView(["passed", "passed", "passed", "passed", "open"]);
const problem = (status: number, json: Record<string, unknown>) => (route: Route) => route.fulfill({ status, json });
const urlField = (page: Page) => page.locator("#artifact-url");

test("T030 SC 4: L2 `author-mismatch` shows the plain-words reason next to the field; the form keeps the URL", async ({
  page,
}) => {
  const branch = "https://github.com/octo/next.js/tree/feature/retry";
  const { calls } = await openTest(page, "L2", {
    ladder: L2_OPEN,
    artifact: problem(422, { error: "artifact-rejected", reason: "author-mismatch" }),
  });
  await expect(page.getByLabel("Branch link")).toBeVisible();
  await expect(page.locator("fieldset.question")).toHaveCount(0);
  await urlField(page).fill(`  ${branch}  `);
  await page.getByRole("button", { name: "Check my branch" }).click();
  const error = page.locator("#artifact-error");
  await expect(error).toHaveText("These commits are not by your GitHub account");
  await expect(urlField(page)).toHaveValue(branch); // trimmed for display, kept
  await expect(urlField(page)).toHaveAttribute("aria-invalid", "true");
  await expect(urlField(page)).toHaveAccessibleDescription(/These commits are not by your GitHub account/);
  expect(calls.artifacts).toEqual([{ url: branch }]);
  await expectNoSeriousAxeViolations(page, "artifact-L2-error");
});

test("T030 AC 3: every T013 reason code and an invalid URL are shown in plain words, never as the raw code", async ({
  page,
}) => {
  let reply: { status: number; json: Record<string, unknown> } = { status: 400, json: { error: "invalid-url" } };
  await openTest(page, "L4", { ladder: L4_OPEN, artifact: (route) => route.fulfill(reply) });
  await expect(page.getByLabel("Repo link or PR link")).toBeVisible();
  await urlField(page).fill("https://github.com.evil.io/x/y");
  const check = page.getByRole("button", { name: "Check my link" });
  await check.click();
  await expect(page.locator("#artifact-error")).toContainText("This is not a link of the right kind");
  const cases: [string, string][] = [
    ["pr-not-merged", "This PR is not merged yet"],
    ["not-found", "GitHub has no public repo, branch or PR at this link"],
    ["no-new-commits", "no new commits of yours"],
    ["not-from-scratch", "fork of the ladder's repo"],
    ["range-too-large", "more than 250 new commits"],
    ["author-mismatch", "These commits are not by your GitHub account"],
  ];
  for (const [reason, text] of cases) {
    reply = { status: 422, json: { error: "artifact-rejected", reason } };
    await check.click();
    await expect(page.locator("#artifact-error")).toContainText(text);
    await expect(page.locator("#artifact-error")).not.toContainText(reason);
  }
});

test("T030 AC 3: an L4 merged PR passes: `Level passed` and the ladder is complete", async ({ page }) => {
  let passed = false;
  await openTest(page, "L4", {
    ladder: () => (passed ? ladderView(["passed", "passed", "passed", "passed", "passed"]) : L4_OPEN),
    artifact: async (route) => {
      passed = true;
      await route.fulfill({ json: { artifact: { id: "7", level: "L4" }, evidence: { level: "L4" } } });
    },
  });
  await urlField(page).fill("https://github.com/vercel/next.js/pull/12");
  await page.getByRole("button", { name: "Check my link" }).click();
  const result = page.locator("[aria-live=polite]");
  await expect(result).toContainText("Level passed");
  await expect(result).toContainText("your ladder is complete");
  await expectNoSeriousAxeViolations(page, "result-l4");
});

test("T030 AC 3: L1 uses the MCQ screen (run-mcq); the run log and explanation are optional feedback only", async ({
  page,
}) => {
  const feedback: unknown[] = [];
  const { calls } = await openTest(page, "L1", { ladder: L1_OPEN });
  await page.route("**/api/ladders/*/levels/L1/run-feedback", (route) => {
    feedback.push(route.request().postDataJSON());
    return feedback.length === 1
      ? route.fulfill({ status: 422, json: { error: "explanation-not-3-sentences" } })
      : route.fulfill({ json: { ok: true } });
  });
  await expect(page.getByRole("heading", { level: 1 })).toContainText("L1 Run it");
  await expect(urlField(page)).toHaveCount(0);
  await expect(page.getByText("Feedback only. It is never scored")).toBeVisible();
  await page.getByLabel("Run log, or a link to it").fill("listening on :3000");
  await page.getByLabel("What it does, in 3 sentences").fill("It starts a server.");
  await page.getByRole("button", { name: "Save feedback" }).click();
  await expect(page.locator("#feedback-status")).toHaveText("Write exactly 3 sentences, each ending with . ! or ?");
  await page
    .getByLabel("What it does, in 3 sentences")
    .fill("It starts a server. It reads a config. It logs requests.");
  await page.getByRole("button", { name: "Save feedback" }).click();
  await expect(page.locator("#feedback-status")).toContainText("Saved. It is feedback only");
  expect(feedback[1]).toEqual({
    runLog: "listening on :3000",
    explanation: "It starts a server. It reads a config. It logs requests.",
  });
  expect(calls.starts).toBe(0); // feedback never starts or scores a test
  await takeTest(page).click();
  await expect(page.locator("fieldset.question")).toHaveCount(10);
  await expectNoSeriousAxeViolations(page, "mcq-L1");
});

test.describe("T030 rate limit in local time (UTC+14)", () => {
  test.use({ timezoneId: "Pacific/Kiritimati" });
  test("T030 SC 6: a 429 shows `Next attempt at` in local time and no start button until `retryAt`", async ({
    page,
  }) => {
    const now = Date.parse("2026-11-24T08:00:00.000Z");
    await page.clock.install({ time: now });
    const retryAt = new Date(now + 3 * 3_600_000).toISOString();
    const { calls } = await openTest(page, "L3", {
      start: problem(429, { error: "too-many-attempts", retryAt }),
    });
    await takeTest(page).click();
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("Next attempt at");
    const local = await page.evaluate((iso) => new Date(iso).toLocaleString(), retryAt);
    expect(local).toContain("2026"); // the browser's own local rendering, in UTC+14
    await expect(alert.locator("time")).toHaveText(local);
    await expect(alert.locator("time")).toHaveAttribute("datetime", retryAt);
    await expect(page.getByRole("button")).toHaveCount(0);
    await expectNoSeriousAxeViolations(page, "rate-limited");
    await page.clock.fastForward(3 * 3_600_000 - 60_000);
    await expect(takeTest(page)).toHaveCount(0);
    await page.clock.fastForward(61_000);
    await expect(takeTest(page)).toBeVisible();
    expect(calls.starts).toBe(1);
  });
});

test("T030 AC 5: `pool-too-small` shows `This level's test is not ready yet`", async ({ page }) => {
  await openTest(page, "L3", { start: problem(422, { error: "pool-too-small" }) });
  await takeTest(page).click();
  await expect(page.getByRole("alert")).toContainText("This level's test is not ready yet");
  await expect(takeTest(page)).toHaveCount(0);
});

test("T030 AC 5: at 30:00 the attempt expires: `This attempt expired` and `Start a new attempt`", async ({ page }) => {
  await page.clock.install({ time: Date.parse("2026-11-24T08:00:00.000Z") });
  const { calls } = await openTest(page, "L3");
  await takeTest(page).click();
  await answer(page, 3);
  await expect(page.getByRole("timer")).toHaveText("30:00");
  await page.clock.fastForward(29 * 60_000 + 58_000);
  await expect(page.getByRole("timer")).toHaveText("0:02");
  await expect(page.getByText("This attempt expired")).toHaveCount(0);
  await page.clock.fastForward(3_000);
  await expect(page.getByRole("alert")).toContainText("This attempt expired");
  await expect(submit(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Start a new attempt" }).click();
  await expect(page.locator("fieldset.question")).toHaveCount(10);
  await expect(page.getByText("0 of 10 answered")).toBeVisible();
  expect(calls.starts).toBe(2);
  expect(calls.submits).toEqual([]);
});

test("T030 AC 5: a server `attempt-expired` on submit also shows `This attempt expired`", async ({ page }) => {
  await openTest(page, "L3", { submit: problem(409, { error: "attempt-expired" }) });
  await takeTest(page).click();
  await answer(page, 10);
  await submit(page).click();
  await expect(page.getByRole("alert")).toContainText("This attempt expired");
  await expect(page.getByRole("button", { name: "Start a new attempt" })).toBeVisible();
  await expect(page.getByText("Level passed")).toHaveCount(0);
});

test("T030 AC 5: offline shows T015's `You are offline — this needs a connection` and sends nothing", async ({
  page,
  context,
}) => {
  const { calls } = await openTest(page, "L3");
  await expect(takeTest(page)).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByText("You are offline — this needs a connection")).toBeVisible();
  await expect(takeTest(page)).toHaveCount(0);
  await context.setOffline(false);
  await takeTest(page).click();
  await answer(page, 10);
  await context.setOffline(true);
  await expect(submit(page)).toHaveCount(0);
  await expect(page.getByText("You are offline — this needs a connection")).toBeVisible();
  await context.setOffline(false);
  await expect(submit(page)).toBeEnabled();
  expect(calls.submits).toEqual([]);
});

test("T030 edge: a network drop on submit shows `Not sent — try again`; the retry sends the same answers", async ({
  page,
}) => {
  let n = 0;
  const { calls } = await openTest(page, "L3", {
    submit: (route) => (n++ === 0 ? route.abort("internetdisconnected") : route.fulfill({ json: failResult })),
  });
  await takeTest(page).click();
  await answer(page, 10, 1);
  await submit(page).click();
  await expect(page.getByRole("alert")).toContainText("Not sent — try again");
  await expect(page.getByText("7 of 10")).toHaveCount(0); // never a result the server did not send
  await submit(page).click();
  await expect(page.locator("[aria-live=polite]")).toContainText("7 of 10 correct");
  expect(calls.submits).toHaveLength(2);
  expect(calls.submits[1]).toEqual(calls.submits[0]);
});

test("T030 edge: a second submit of the same attempt (other tab) shows `Already submitted`", async ({ page }) => {
  await openTest(page, "L3", { submit: problem(409, { error: "already-submitted" }) });
  await takeTest(page).click();
  await answer(page, 10);
  await submit(page).click();
  await expect(page.getByRole("alert")).toContainText("Already submitted");
  await expect(page.getByText("Level passed")).toHaveCount(0);
});
