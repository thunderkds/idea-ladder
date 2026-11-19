// T005 start flow: /start?url= -> sign-in -> /jobs/:jobId status page (AC 3, AC 7, Success Criterion 7).
// The e2e server (e2e/serve.ts) replays recorded GitHub fixtures and runs the Inngest function in-process
// with @inngest/test: lukeed/dset runs normally (slowed so each status is visible), developit/mitt hits the
// rate limit in fetch-repo, the-pocket/pocketflow is never picked up (stays Queued).
import { expect, type Page, test } from "@playwright/test";

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

const STATUS_TOKENS: [string, string, string][] = [
  ["body", "background-color", "--color-bg"],
  ["h1", "color", "--color-text"],
  ["h1", "font-family", "--font-family"],
  ["h1", "font-size", "--font-size-h1"],
  ["h1", "font-weight", "--font-weight-strong"],
  [".status-detail", "color", "--color-text-muted"],
  [".status-detail", "font-size", "--font-size-body"],
  ["main", "padding-top", "--space-8"],
  ["main", "padding-left", "--space-4"],
  ["main", "max-width", "--content-max"],
];

const JOB_URL = /\/jobs\/[0-9a-f-]{36}$/;
const heading = (page: Page) => page.getByRole("heading", { level: 1 });

test("SC 7: signed out /start?url=lukeed/dset -> sign-in -> /jobs/:id shows Queued, Reading the repo, Picking core files, Done", async ({
  page,
}) => {
  await page.goto("/start?url=https://github.com/lukeed/dset");
  await expect(page).toHaveURL(JOB_URL); // sign-in returned to /start, which redirected to the job
  await expect(heading(page)).toHaveText("Queued");
  await expect(page.getByText("lukeed/dset")).toBeVisible();
  await expect(heading(page)).toHaveText("Reading the repo", { timeout: 10_000 });
  await expectTokens(page, STATUS_TOKENS);
  await shootAll(page, "job-running");
  // T006: the pick-core-files step (job status picking) shows its own text.
  await expect(heading(page)).toHaveText("Picking core files", { timeout: 15_000 });
  await expect(page.locator(".status-detail")).toHaveText("This page updates by itself.");
  await expectTokens(page, STATUS_TOKENS);
  await shootAll(page, "job-picking");
  await expect(heading(page)).toHaveText("Done", { timeout: 15_000 });
  await expect(page.locator(".status-detail")).toHaveText("The repo is read and its concepts are mapped.");
  await expectTokens(page, STATUS_TOKENS);
  await shootAll(page, "job-done");

  // Polling stops on a final status: no /api/jobs request in the next 5 s.
  let polls = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/jobs/")) polls++;
  });
  await page.waitForTimeout(5_000);
  expect(polls).toBe(0);

  // Same repo + SHA again: the same job (AC 4 reuse), already Done.
  const jobUrl = page.url();
  await page.goto("/start?url=lukeed/dset");
  expect(page.url()).toBe(jobUrl);
  await expect(heading(page)).toHaveText("Done");
});

test("a job no worker has picked up shows Queued (screenshots)", async ({ page }) => {
  await page.goto("/start?url=https://github.com/the-pocket/pocketflow");
  await expect(page).toHaveURL(JOB_URL);
  await expect(heading(page)).toHaveText("Queued");
  await expectTokens(page, STATUS_TOKENS);
  await shootAll(page, "job-queued");
});

test("rate limit in fetch-repo -> Failed: rate-limited with the reset time in plain words", async ({ page }) => {
  await page.goto("/start?url=https://github.com/developit/mitt");
  await expect(page).toHaveURL(JOB_URL);
  await expect(heading(page)).toHaveText("Failed: rate-limited", { timeout: 15_000 });
  const detail = page.locator(".status-detail");
  await expect(detail).toContainText("GitHub rate limit");
  await expect(detail).toContainText("2030");
  await expect(page.locator("body")).not.toContainText("{");
  await expect(page.locator("body")).not.toContainText("Error:");
  await expectTokens(page, STATUS_TOKENS);
  await shootAll(page, "job-failed");
});

test("unsupported URL: /start says only GitHub repos work and shows the given URL, escaped", async ({ page }) => {
  const given = "https://gitlab.com/o/n?<b>x</b>";
  const res = await page.goto(`/start?url=${encodeURIComponent(given)}`);
  expect(res?.status()).toBe(400);
  await expect(heading(page)).toHaveText("Only GitHub repos work for now");
  await expect(page.locator(".long-text")).toHaveText(given);
  expect(await page.locator("main b").count()).toBe(0);
  await expectTokens(page, [
    ["h1", "color", "--color-text"],
    ["h1", "font-size", "--font-size-h1"],
    [".long-text", "font-size", "--font-size-body"],
    ["main", "padding-top", "--space-8"],
  ]);
  await shootAll(page, "start-unsupported");
});

test("long URL wraps on mobile: no horizontal scroll at 360px", async ({ page }) => {
  const given = `https://example.com/${"a".repeat(300)}`;
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto(`/start?url=${encodeURIComponent(given)}`);
  await expect(page.locator(".long-text")).toHaveText(given);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(360);
});

test("unknown job id -> Job not found", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in with GitHub" }).click();
  await expect(page).toHaveURL(/\/ladders$/);
  await page.goto("/jobs/00000000-0000-0000-0000-000000000000");
  await expect(heading(page)).toHaveText("Job not found");
});
