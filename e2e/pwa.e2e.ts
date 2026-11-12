// T015 client: installable PWA (manifest, service worker, install offer), offline review from the cached pack with a
// local scheduleNext and an IndexedDB rating queue, sync on reconnect, sign-out clearing, settings (reminders, export,
// import) and the offline notice on ladder generation. The T015 API is mocked with context.route (contract:
// src/shared/offline.ts), so these tests check the client only; the server side has its own bun tests.
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { type BrowserContext, expect, type Page, type Route, test } from "@playwright/test";
import { type Card, newCard, scheduleNext } from "../src/server/scheduler.ts";
import type {
  CardStateJson,
  ImportResult,
  OfflineCard,
  OfflinePack,
  PushStatus,
  SyncRequest,
  SyncResponse,
} from "../src/shared/offline.ts";
import type { Rating, ReviewQueue } from "../src/shared/review.ts";

const VIEWPORTS = [
  { name: "mobile", width: 360, height: 740 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 800 },
];
const START = new Date("2026-11-12T08:00:00Z");
const LEARNER = "7a0c6c1e-0000-4000-8000-000000000042";

const toCard = (s: CardStateJson): Card => ({
  ...s,
  due: new Date(s.due),
  last_review: s.last_review ? new Date(s.last_review) : undefined,
});
const toJson = (c: Card): CardStateJson => ({
  due: c.due.toISOString(),
  stability: c.stability,
  difficulty: c.difficulty,
  elapsed_days: c.elapsed_days,
  scheduled_days: c.scheduled_days,
  learning_steps: c.learning_steps,
  reps: c.reps,
  lapses: c.lapses,
  state: c.state as CardStateJson["state"],
  last_review: c.last_review ? c.last_review.toISOString() : null,
});
/** A real ts-fsrs state: one `easy` rating at `at`. */
const ratedOnce = (at: string) => toJson(scheduleNext(newCard(new Date(at)), "easy", new Date(at)));

const card = (cardId: string, front: string, dueAt: string, cardState: CardStateJson | null): OfflineCard => ({
  cardId,
  ladderId: "1",
  level: "L0",
  front,
  back: `Answer to ${front}`,
  dueAt,
  cardState,
});
const DUE_REVIEW = ratedOnce("2026-11-01T08:00:00Z"); // due a few days later, before START
const LATER = ratedOnce("2026-11-11T08:00:00Z"); // due after START
const PACK: OfflinePack = {
  learnerId: LEARNER,
  githubId: 42,
  generatedAt: START.toISOString(),
  sessionLimitMs: 300_000,
  cards: [
    card("201", "What does the offline pack hold?", "2026-11-12T06:00:00.000Z", null),
    card("202", "Why does the server stay the source of truth?", "2026-11-12T06:30:00.000Z", null),
    card("203", "What keeps a retried rating from counting twice?", DUE_REVIEW.due, DUE_REVIEW),
    card("204", "A card that is not due yet", LATER.due, LATER),
  ],
};
const onlineQueue = (pack: OfflinePack): ReviewQueue => ({
  nowIso: START.toISOString(),
  sessionLimitMs: pack.sessionLimitMs,
  hasCards: true,
  nextDueAt: null,
  cards: pack.cards.slice(0, 3).map(({ cardState: _s, ...c }) => c),
});

type Api = {
  pack: OfflinePack | number;
  syncStatus: (n: number) => number;
  syncBodies: SyncRequest[];
  /** What the mocked server stores after an applied sync; the next pack is built from it. */
  serverStates: Map<string, CardStateJson>;
  calls: string[];
  /** context.route answers before the network, so the mock itself must fail while the context is offline. */
  offline: boolean;
};
/** Mocks the review and offline API on the context, so requests from the page and its service worker are both seen. */
async function mockApi(context: BrowserContext, init: Partial<Api> = {}) {
  const api: Api = {
    pack: PACK,
    syncStatus: () => 200,
    syncBodies: [],
    serverStates: new Map(),
    calls: [],
    offline: false,
    ...init,
  };
  const currentPack = (): OfflinePack | number =>
    typeof api.pack === "number"
      ? api.pack
      : {
          ...api.pack,
          cards: api.pack.cards.map((c) => ({ ...c, cardState: api.serverStates.get(c.cardId) ?? c.cardState })),
        };
  await context.route("**/api/**", (route: Route) => {
    const url = new URL(route.request().url());
    if (api.offline) return route.abort("internetdisconnected");
    api.calls.push(`${route.request().method()} ${url.pathname}`);
    if (url.pathname === "/api/review/offline-pack") {
      const pack = currentPack();
      return typeof pack === "number" ? route.fulfill({ status: pack, json: {} }) : route.fulfill({ json: pack });
    }
    if (url.pathname === "/api/review/queue") {
      const pack = currentPack();
      return typeof pack === "number"
        ? route.fulfill({ status: pack, json: {} })
        : route.fulfill({ json: onlineQueue(pack) });
    }
    if (url.pathname === "/api/review/rate") {
      const body = route.request().postDataJSON() as { cardId: string };
      return route.fulfill({
        json: { cardId: body.cardId, dueAt: "2026-11-13T08:00:00.000Z", state: "learning", duplicate: false },
      });
    }
    if (url.pathname === "/api/review/sync") {
      const body = route.request().postDataJSON() as SyncRequest;
      const status = api.syncStatus(api.syncBodies.length);
      api.syncBodies.push(body);
      if (status !== 200) return route.fulfill({ status, json: { error: "boom" } });
      // The server's answer: its own (here: a fixed, recognisable) state per applied rating.
      const results: SyncResponse["results"] = body.ratings.map((r, i) => {
        const state = { ...ratedOnce(r.reviewedAt), reps: 100 + i };
        api.serverStates.set(r.cardId, state);
        return { idempotencyKey: r.idempotencyKey, cardId: r.cardId, status: "applied", card: state };
      });
      return route.fulfill({ json: { results } satisfies SyncResponse });
    }
    return route.fallback();
  });
  return api;
}

/** The browser and the API mock go offline (or online) together. */
async function setOffline(context: BrowserContext, api: Api, offline: boolean) {
  api.offline = offline;
  await context.setOffline(offline);
}

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in with GitHub" }).click();
  await expect(page).toHaveURL(/\/ladders$/);
}
/** The service worker is active (shell precached) and controls this page. */
async function swReady(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  // A page whose navigation started while the worker was activating is not claimed; its next load is controlled.
  const controlled = () => page.evaluate(() => navigator.serviceWorker.controller !== null);
  if (!(await controlled())) await page.reload();
  await expect.poll(controlled).toBe(true);
}

/** All records of one IndexedDB store, read in the page without creating the database. */
const readStore = <T>(page: Page, store: "packs" | "queue" | "meta") =>
  page.evaluate(
    (store) =>
      new Promise<unknown[]>((resolve) => {
        const req = indexedDB.open("idea-ladder");
        req.onupgradeneeded = () => req.transaction?.abort();
        req.onerror = () => resolve([]);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(store)) return resolve([]);
          const all = db.transaction(store).objectStore(store).getAll();
          all.onsuccess = () => {
            resolve(all.result);
            db.close();
          };
        };
      }),
    store,
  ) as Promise<T[]>;
type Queued = {
  cardId: string;
  rating: Rating;
  idempotencyKey: string;
  elapsedMs: number;
  reviewedAt: string;
  learnerId: string;
};

/** Screenshots go to test-results/screenshots (git-ignored); the committed copies are e2e/baseline/pwa-*.png, settings-*.png. */
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

/** Every visible button, link-button, select and file input is at least 44 x 44 px at each viewport; text >= 16 px. */
async function expectTapTargets(page: Page, selector: string) {
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const boxes = await page.locator(selector).evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return {
          text: (e.textContent ?? "").trim() || e.id,
          w: r.width,
          h: r.height,
          font: getComputedStyle(e).fontSize,
        };
      }),
    );
    expect(boxes.length).toBeGreaterThan(0);
    for (const b of boxes) {
      expect(b.w, `${vp.name}: "${b.text}" width >= 44`).toBeGreaterThanOrEqual(44);
      expect(b.h, `${vp.name}: "${b.text}" height >= 44`).toBeGreaterThanOrEqual(44);
      expect(Number.parseFloat(b.font), `${vp.name}: "${b.text}" text >= 16px`).toBeGreaterThanOrEqual(16);
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
}

async function expectNoSeriousAxeViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  const bad = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

const question = (page: Page) => page.locator(".review-front");
const heading = (page: Page) => page.getByRole("heading", { level: 1 });

test("T015 AC 1: manifest served and valid, icons 192/512 reachable, service worker active, app installable", async ({
  page,
}) => {
  const res = await page.request.get("/manifest.webmanifest");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/manifest+json");
  const manifest = (await res.json()) as {
    name: string;
    short_name: string;
    display: string;
    start_url: string;
    scope: string;
    theme_color: string;
    background_color: string;
    icons: { src: string; sizes: string; type: string; purpose: string }[];
  };
  expect(manifest).toMatchObject({ name: "Idea Ladder", display: "standalone", start_url: "/review", scope: "/" });
  for (const size of [192, 512]) {
    const icon = manifest.icons.find((i) => i.sizes === `${size}x${size}` && i.purpose === "any");
    expect(icon, `icon ${size}`).toBeDefined();
    const png = await page.request.get(icon?.src ?? "");
    expect(png.status()).toBe(200);
    expect(png.headers()["content-type"]).toBe("image/png");
    const body = await png.body();
    expect([body.readUInt32BE(16), body.readUInt32BE(20)], `icon ${size} dimensions`).toEqual([size, size]);
  }

  await page.goto("/");
  await swReady(page);
  const sw = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return { state: reg.active?.state, script: reg.active?.scriptURL, scope: reg.scope };
  });
  expect(sw).toEqual({ state: "activated", script: "http://localhost:54401/sw.js", scope: "http://localhost:54401/" });
  // The manifest link, and theme colors equal to the theme tokens.
  const theme = await page.evaluate(() => ({
    link: document.querySelector('link[rel="manifest"]')?.getAttribute("href"),
    meta: document.querySelector('meta[name="theme-color"]')?.getAttribute("content"),
    accent: getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim(),
    bg: getComputedStyle(document.documentElement).getPropertyValue("--color-bg").trim(),
  }));
  expect(theme.link).toBe("/manifest.webmanifest");
  expect(manifest.theme_color).toBe(theme.accent);
  expect(theme.meta).toBe(theme.accent);
  expect(manifest.background_color).toBe(theme.bg);
  // Chromium's own installability check (the reasons beforeinstallprompt would not fire): none.
  const cdp = await page.context().newCDPSession(page);
  const { installabilityErrors } = (await cdp.send("Page.getInstallabilityErrors")) as {
    installabilityErrors: { errorId: string }[];
  };
  expect(installabilityErrors.map((e) => e.errorId)).toEqual([]);
});

test("T015 AC 1: the install offer is absent on first load and shows only on Session done", async ({
  page,
  context,
}) => {
  await mockApi(context, { pack: { ...PACK, cards: PACK.cards.slice(0, 1) } });
  await page.addInitScript(() => {
    (window as unknown as { offerInstall: () => void }).offerInstall = () => {
      const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
        prompt: async () => {
          (window as unknown as { prompted: number }).prompted = 1;
        },
        userChoice: Promise.resolve({ outcome: "accepted" }),
      });
      window.dispatchEvent(event);
    };
  });
  const offer = (p: Page) => p.getByRole("region", { name: "Install app" });
  await signIn(page);
  await page.evaluate(() => (window as unknown as { offerInstall: () => void }).offerInstall());
  await expect(offer(page)).toHaveCount(0);
  await page.goto("/review");
  await expect(question(page)).toBeVisible();
  await page.evaluate(() => (window as unknown as { offerInstall: () => void }).offerInstall());
  await expect(offer(page)).toHaveCount(0); // never during the review
  await page.keyboard.press("Space");
  await page.keyboard.press("3");
  await expect(heading(page)).toHaveText("Session done");
  await expect(offer(page)).toBeVisible();
  await expect(offer(page).getByText("Install Idea Ladder to review offline and get a daily reminder.")).toBeVisible();
  await expect(offer(page).getByRole("button")).toHaveText(["Install", "Not now"]);
  await expectTokens(page, [
    [".install-offer", "background-color", "--color-surface"],
    [".install-offer", "border-top-color", "--color-border"],
    // Back to My ladders stays the one primary action; the offer's buttons use the quiet style.
    ["a.button:not(.button-quiet)", "background-color", "--color-accent"],
    [".install-actions .button", "background-color", "--color-surface"],
    [".install-actions .button", "color", "--color-text"],
    [".install-actions .button", "border-top-color", "--color-border"],
    [".install-offer p", "font-size", "--font-size-body"],
  ]);
  await expectTapTargets(page, ".install-actions .button");
  await expectNoSeriousAxeViolations(page);
  await shootAll(page, "pwa-install-offer");
  await offer(page).getByRole("button", { name: "Install" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { prompted?: number }).prompted)).toBe(1);
  await expect(offer(page)).toHaveCount(0);
});

test("T015 AC 2+3: offline review from the cached pack, local scheduleNext, IndexedDB queue, ordered sync on reconnect", async ({
  page,
  context,
}) => {
  await page.clock.install({ time: START });
  // Sync call 0 fails with 500 (the queue stays), call 1 succeeds.
  const api = await mockApi(context, { syncStatus: (n) => (n === 0 ? 500 : 200) });
  await signIn(page);
  await page.goto("/review"); // the one online visit
  await expect(question(page)).toHaveText(PACK.cards[0]?.front ?? "");
  await swReady(page);
  await expect
    .poll(async () => (await readStore<OfflinePack>(page, "packs")).map((p) => p.learnerId))
    .toEqual([LEARNER]);

  await setOffline(context, api, true);
  await page.reload();
  const banner = page.locator(".offline-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("Offline");
  await expect(page.getByText("Card 1 of 3")).toBeVisible();
  // The server's order: the due rated card first, then the New cards; the card due later is not shown.
  await expect(question(page)).toHaveText(PACK.cards[2]?.front ?? "");
  await expect(page.getByText(PACK.cards[3]?.front ?? "")).toHaveCount(0);
  await expectTokens(page, [
    [".offline-banner", "background-color", "--color-surface"],
    [".offline-banner", "color", "--color-text"],
    [".offline-banner", "border-top-color", "--color-accent"],
    [".offline-banner", "font-size", "--font-size-body"],
    [".offline-banner", "font-family", "--font-family"],
    [".review-show", "background-color", "--color-accent"],
  ]);
  await expectTapTargets(page, ".bar-links a, .review-show");
  await expectNoSeriousAxeViolations(page);
  await shootAll(page, "pwa-offline-front");
  await page.getByRole("button", { name: "Show answer" }).click();
  // The banner sits above the card in the flow: it never covers the rating buttons.
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const [b, r] = [await banner.boundingBox(), await page.locator(".review-ratings").boundingBox()];
    expect(b && r && b.y + b.height <= r.y, `${vp.name}: banner above the ratings`).toBe(true);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await expectNoSeriousAxeViolations(page);
  await shootAll(page, "pwa-offline-back");

  const ratings: Rating[] = ["good", "again", "easy"];
  for (const [n, rating] of ratings.entries()) {
    if (n > 0) await page.getByRole("button", { name: "Show answer" }).click();
    await page.clock.fastForward(3_000);
    await page.getByRole("button", { name: rating[0]?.toUpperCase() + rating.slice(1) }).click();
  }
  await expect(heading(page)).toHaveText("Session done");
  await expect(page.getByText("You rated 3 cards this session.")).toBeVisible();
  await expect(banner).toBeVisible();

  const queued = await readStore<Queued>(page, "queue");
  expect(queued.map((q) => [q.cardId, q.rating, q.learnerId])).toEqual([
    ["203", "good", LEARNER],
    ["201", "again", LEARNER],
    ["202", "easy", LEARNER],
  ]);
  for (const q of queued) {
    expect(q.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(q.elapsedMs).toBeGreaterThanOrEqual(3_000);
  }
  expect(new Set(queued.map((q) => q.idempotencyKey)).size).toBe(3);
  expect(queued.map((q) => q.reviewedAt)).toEqual([...queued.map((q) => q.reviewedAt)].sort());
  // The local state of each rated card equals a direct scheduleNext call with the same inputs.
  const [local] = await readStore<OfflinePack>(page, "packs");
  for (const q of queued) {
    const before = PACK.cards.find((c) => c.cardId === q.cardId)?.cardState ?? null;
    const at = new Date(q.reviewedAt);
    const want = toJson(scheduleNext(before ? toCard(before) : newCard(at), q.rating, at));
    expect(local?.cards.find((c) => c.cardId === q.cardId)?.cardState, `card ${q.cardId}`).toEqual(want);
  }
  expect(api.syncBodies).toHaveLength(0); // nothing is sent while offline

  // Back online: the queue is sent in order; the first sync answers 500, so everything stays queued.
  await setOffline(context, api, false);
  await expect(banner).toHaveCount(0);
  await expect.poll(() => api.syncBodies.length).toBe(1);
  const sent = (n: number) =>
    api.syncBodies[n]?.ratings.map((r) => [r.cardId, r.rating, r.idempotencyKey, r.reviewedAt]);
  expect(sent(0)).toEqual(queued.map((q) => [q.cardId, q.rating, q.idempotencyKey, q.reviewedAt]));
  await page.waitForTimeout(300);
  expect(await readStore<Queued>(page, "queue")).toHaveLength(3);

  // Next try (the online event again): the same keys, the queue empties, the local state equals the server state.
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => api.syncBodies.length).toBe(2);
  expect(sent(1)).toEqual(sent(0));
  await expect.poll(async () => (await readStore<Queued>(page, "queue")).length).toBe(0);
  await expect
    .poll(async () => {
      const [pack] = await readStore<OfflinePack>(page, "packs");
      return queued.map((q) => pack?.cards.find((c) => c.cardId === q.cardId)?.cardState);
    })
    .toEqual(queued.map((q) => api.serverStates.get(q.cardId)));
});

test("T015: no cached pack offline shows the plain message once, with no error loop", async ({ page, context }) => {
  const api = await mockApi(context, { pack: 404 }); // the review was never opened online: no pack is ever stored
  await signIn(page);
  await swReady(page);
  await page.waitForTimeout(500);
  expect(await readStore<OfflinePack>(page, "packs")).toEqual([]);
  await setOffline(context, api, true);
  await page.goto("/review");
  await expect(page.getByText("You are offline and have not opened your review online yet.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/review");
  await page.waitForTimeout(1_000);
  await expect(page.getByText("You are offline and have not opened your review online yet.")).toHaveCount(1);
  await expectNoSeriousAxeViolations(page);
});

test("T015: sign-out clears the offline pack, the queue and the cached shell", async ({ page, context }) => {
  await mockApi(context);
  await signIn(page);
  await swReady(page);
  await expect.poll(async () => (await readStore<OfflinePack>(page, "packs")).length).toBe(1);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const req = indexedDB.open("idea-ladder");
        req.onsuccess = () => {
          const tx = req.result.transaction("queue", "readwrite");
          tx.objectStore("queue").add({
            cardId: "201",
            rating: "good",
            idempotencyKey: crypto.randomUUID(),
            elapsedMs: 1000,
            reviewedAt: new Date().toISOString(),
            learnerId: "x",
          });
          tx.oncomplete = () => {
            req.result.close();
            resolve();
          };
        };
      }),
  );
  expect(await readStore(page, "queue")).toHaveLength(1);
  expect(await page.evaluate(async () => (await caches.match("/index.html")) !== undefined)).toBe(true);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: "Sign in with GitHub" })).toBeVisible();
  expect(await readStore(page, "packs")).toEqual([]);
  expect(await readStore(page, "queue")).toEqual([]);
  expect(await readStore(page, "meta")).toEqual([]);
  expect(await page.evaluate(async () => (await caches.match("/index.html")) === undefined)).toBe(true);
});

test("T015: a 401 clears another learner's cached cards; offline then shows none of them", async ({
  page,
  context,
}) => {
  const other: OfflinePack = {
    ...PACK,
    learnerId: "someone-else",
    cards: [card("901", "Another learner's private card", "2026-01-01T00:00:00.000Z", null)],
  };
  const api = await mockApi(context);
  await signIn(page);
  await swReady(page);
  await expect.poll(async () => (await readStore<OfflinePack>(page, "packs")).length).toBe(1);
  // Left-over data of another learner (for example a session that ended without sign-out).
  await page.evaluate(
    (pack) =>
      new Promise<void>((resolve) => {
        const req = indexedDB.open("idea-ladder");
        req.onsuccess = () => {
          const tx = req.result.transaction(["packs", "meta"], "readwrite");
          tx.objectStore("packs").clear();
          tx.objectStore("packs").put(pack);
          tx.objectStore("meta").put(pack.learnerId, "learner");
          tx.oncomplete = () => {
            req.result.close();
            resolve();
          };
        };
      }),
    other,
  );
  // The session is gone (server and API): the next refresh gets a 401, and the app forgets the cached cards.
  api.pack = 401;
  await context.clearCookies();
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(async () => (await readStore(page, "packs")).length).toBe(0);
  // meta.learner stays, so a queue made offline is synced after the same learner signs in again (never shown).
  expect(await readStore(page, "meta")).toEqual(["someone-else"]);
  await expect(page).toHaveURL(/\/$/);
  // The 401 also emptied the service worker cache, so offline /review has no app shell until the next online visit:
  // the browser's own offline page, and never the other learner's cards.
  expect(await page.evaluate(async () => (await caches.match("/index.html")) === undefined)).toBe(true);
  await setOffline(context, api, true);
  await page.goto("/review").catch(() => undefined);
  await expect(page.getByText("Another learner's private card")).toHaveCount(0);
});

/** Adds one rating to the IndexedDB queue as if it had been made offline; returns its idempotency key. */
const addQueued = (page: Page, learnerId: string, cardId = "201") =>
  page.evaluate(
    ({ learnerId, cardId }) =>
      new Promise<string>((resolve) => {
        const key = crypto.randomUUID();
        const req = indexedDB.open("idea-ladder");
        req.onsuccess = () => {
          const tx = req.result.transaction("queue", "readwrite");
          tx.objectStore("queue").add({
            cardId,
            rating: "good",
            idempotencyKey: key,
            elapsedMs: 1000,
            reviewedAt: new Date().toISOString(),
            learnerId,
          });
          tx.oncomplete = () => {
            req.result.close();
            resolve(key);
          };
        };
      }),
    { learnerId, cardId },
  );
const shellCached = (page: Page) => page.evaluate(async () => (await caches.match("/index.html")) !== undefined);

test("T015 fix: a 401 on sync keeps the offline queue, drops the pack and caches, goes to sign-in; the same learner's next sign-in syncs it", async ({
  page,
  context,
}) => {
  const api = await mockApi(context, { syncStatus: (n) => (n === 0 ? 401 : 200) });
  await signIn(page);
  await page.goto("/review");
  await expect(question(page)).toHaveText(PACK.cards[0]?.front ?? "");
  await swReady(page);
  await expect.poll(async () => (await readStore<OfflinePack>(page, "packs")).length).toBe(1);
  await setOffline(context, api, true);
  await page.reload();
  await expect(page.locator(".offline-banner")).toBeVisible();
  await page.getByRole("button", { name: "Show answer" }).click();
  await page.getByRole("button", { name: "Good" }).click();
  await expect(page.getByText("Card 2 of 3")).toBeVisible();
  const [queued] = await readStore<Queued>(page, "queue");
  expect(queued?.learnerId).toBe(LEARNER);

  // Back online, the session has expired (server and API): the sync answers 401.
  await context.clearCookies();
  await setOffline(context, api, false);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: "Sign in with GitHub" })).toBeVisible();
  expect(api.syncBodies).toHaveLength(1);
  await expect.poll(async () => (await readStore(page, "packs")).length).toBe(0);
  expect((await readStore<Queued>(page, "queue")).map((q) => q.idempotencyKey)).toEqual([queued?.idempotencyKey]);
  expect(await readStore(page, "meta")).toEqual([LEARNER]);
  expect(await shellCached(page)).toBe(false);

  // The same learner signs in again: the kept queue is sent and drained, then the pack is fetched again.
  await signIn(page);
  await expect.poll(() => api.syncBodies.length).toBe(2);
  expect(api.syncBodies[1]?.ratings.map((r) => r.idempotencyKey)).toEqual([queued?.idempotencyKey]);
  await expect.poll(async () => (await readStore(page, "queue")).length).toBe(0);
  await expect.poll(async () => (await readStore(page, "packs")).length).toBe(1);
});

test("T015 fix: explicit sign-out online syncs the queue first, then clears everything; a failed sync still clears", async ({
  page,
  context,
}) => {
  const api = await mockApi(context);
  await signIn(page);
  await swReady(page);
  await expect.poll(async () => (await readStore(page, "packs")).length).toBe(1);
  const key = await addQueued(page, LEARNER);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(api.syncBodies.map((b) => b.ratings.map((r) => r.idempotencyKey))).toEqual([[key]]);
  for (const store of ["packs", "queue", "meta"] as const) expect(await readStore(page, store)).toEqual([]);
  expect(await shellCached(page)).toBe(false);

  // The sync fails: sign-out still clears everything and is not blocked.
  api.syncStatus = () => 500;
  await signIn(page);
  await expect.poll(async () => (await readStore(page, "packs")).length).toBe(1);
  await addQueued(page, LEARNER);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(api.syncBodies).toHaveLength(2);
  for (const store of ["packs", "queue", "meta"] as const) expect(await readStore(page, store)).toEqual([]);
});

test("T015 fix: every sync names the queue's learner; a 409 wrong-learner keeps the queue, shows nothing, does not loop", async ({
  page,
  context,
}) => {
  const api = await mockApi(context, { syncStatus: () => 409 });
  await signIn(page);
  await swReady(page);
  await expect.poll(async () => (await readStore(page, "packs")).length).toBe(1);
  const key = await addQueued(page, LEARNER);
  await page.goto("/review"); // app open: one sync
  await expect(question(page)).toBeVisible();
  await expect.poll(() => api.syncBodies.length).toBe(1);
  expect(api.syncBodies[0]?.learnerId).toBe(LEARNER);
  await page.waitForTimeout(1_500);
  expect(api.syncBodies).toHaveLength(1); // no retry loop
  expect((await readStore<Queued>(page, "queue")).map((q) => q.idempotencyKey)).toEqual([key]);
  expect(await readStore(page, "meta")).toEqual([LEARNER]);
  expect(await readStore(page, "packs")).toHaveLength(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page).toHaveURL(/\/review$/);
  // The next `online` event tries once more.
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => api.syncBodies.length).toBe(2);
  await page.waitForTimeout(500);
  expect(api.syncBodies).toHaveLength(2);
});

test("T015 fix: a session started online survives the network dropping; the rating queues with the same key and syncs", async ({
  page,
  context,
}) => {
  const api = await mockApi(context);
  const rateKeys: string[] = [];
  page.on("request", (req) => {
    if (new URL(req.url()).pathname === "/api/review/rate") rateKeys.push(req.postDataJSON().idempotencyKey);
  });
  await signIn(page);
  await page.goto("/review");
  await expect(question(page)).toHaveText(PACK.cards[0]?.front ?? "");
  await expect.poll(async () => (await readStore(page, "packs")).length).toBe(1);
  await setOffline(context, api, true);
  await page.getByRole("button", { name: "Show answer" }).click();
  await page.getByRole("button", { name: "Good" }).click();
  await expect(page.locator(".offline-banner")).toBeVisible();
  await expect(page.getByText("Card 2 of 3")).toBeVisible();
  await expect(question(page)).toHaveText(PACK.cards[1]?.front ?? "");
  await expect(page.getByText("Could not save your rating")).toHaveCount(0);
  const queued = await readStore<Queued>(page, "queue");
  expect(queued.map((q) => [q.cardId, q.rating, q.learnerId])).toEqual([["201", "good", LEARNER]]);
  expect(rateKeys).toEqual([queued[0]?.idempotencyKey]);

  await setOffline(context, api, false);
  await expect(page.locator(".offline-banner")).toHaveCount(0);
  await expect.poll(() => api.syncBodies.length).toBe(1);
  expect(api.syncBodies[0]?.ratings.map((r) => r.idempotencyKey)).toEqual(rateKeys);
  await expect.poll(async () => (await readStore(page, "queue")).length).toBe(0);
});

test("T015 AC 7: ladder generation offline shows the notice and sends no request", async ({ page, context }) => {
  const api = await mockApi(context);
  await signIn(page);
  await swReady(page);
  await page.waitForLoadState("networkidle"); // My ladders' own requests are done before counting starts
  const requests: { path: string; fromSw: boolean }[] = [];
  context.on("requestfinished", async (req) => {
    const path = new URL(req.url()).pathname;
    requests.push({ path, fromSw: (await req.response())?.fromServiceWorker() ?? false });
  });
  context.on("requestfailed", (req) => requests.push({ path: new URL(req.url()).pathname, fromSw: false }));
  await setOffline(context, api, true);
  await page.goto("/start?url=https://github.com/lukeed/klona");
  await expect(page.getByText("You are offline — this needs a connection")).toBeVisible();
  await expect(heading(page)).toHaveText("Start a ladder");
  await expect(page.getByRole("link", { name: "Try again" })).toHaveAttribute(
    "href",
    "/start?url=https://github.com/lukeed/klona",
  );
  await page.waitForTimeout(500);
  // The only /start request is the navigation the service worker answered from its cache; no API call at all.
  expect(requests.filter((r) => r.path.startsWith("/api/"))).toEqual([]);
  expect(requests.filter((r) => r.path === "/start")).toEqual([{ path: "/start", fromSw: true }]);
  await expectTokens(page, [
    [".offline-notice", "background-color", "--color-surface"],
    [".offline-notice p", "font-size", "--font-size-body"],
    [".offline-actions .button:not(.button-quiet)", "background-color", "--color-accent"],
  ]);
  await expectTapTargets(page, ".offline-actions .button");
  await expectNoSeriousAxeViolations(page);
  await shootAll(page, "pwa-offline-start");
});

// ---- Settings ----

const STATUS: PushStatus = {
  configured: true,
  publicKey: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U",
  subscribed: false,
  hour: null,
  timezone: null,
};
type SettingsMock = { status: PushStatus; subscribed: unknown[]; unsubscribed: unknown[]; imports: number };
async function mockSettings(
  context: BrowserContext,
  status: PushStatus,
  importAnswer: (n: number) => { status: number; json: unknown } = () => ({ status: 200, json: {} }),
) {
  const mock: SettingsMock = { status, subscribed: [], unsubscribed: [], imports: 0 };
  await context.route("**/api/push/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/push/status") return route.fulfill({ json: mock.status });
    if (path === "/api/push/subscribe") mock.subscribed.push(route.request().postDataJSON());
    if (path === "/api/push/unsubscribe") mock.unsubscribed.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true } });
  });
  await context.route("**/api/progress/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/progress/export") {
      return route.fulfill({
        body: JSON.stringify({ format: "idea-ladder-progress", version: 1 }),
        headers: {
          "content-type": "application/json",
          "content-disposition": 'attachment; filename="idea-ladder-progress-2026-11-12.json"',
        },
      });
    }
    const answer = importAnswer(mock.imports++);
    return route.fulfill({ status: answer.status, json: answer.json });
  });
  return mock;
}
/** A fake push subscription, since headless Chromium has no push service. */
async function stubPush(page: Page) {
  await page.addInitScript(() => {
    const sub = {
      endpoint: "https://push.example/send/abc",
      toJSON: () => ({ endpoint: "https://push.example/send/abc", keys: { p256dh: "p256dh-key", auth: "auth-key" } }),
      unsubscribe: async () => true,
    };
    let active: typeof sub | null = null;
    PushManager.prototype.subscribe = async () => {
      active = sub;
      return sub as unknown as PushSubscription;
    };
    PushManager.prototype.getSubscription = async () => active as unknown as PushSubscription | null;
  });
}

test.describe("T015 settings", () => {
  test.use({ timezoneId: "Europe/Berlin", locale: "en-US" });

  test("T015 AC 4: Turn on reminders posts the subscription with the hour and timezone; Turn off removes it", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["notifications"]);
    // Headless Chromium still reports "denied" after grantPermissions, so the page sees a granted permission here.
    await page.addInitScript(() => {
      Object.defineProperty(Notification, "permission", { get: () => "granted" });
      Notification.requestPermission = async () => "granted";
    });
    await stubPush(page);
    const mock = await mockSettings(context, STATUS);
    await signIn(page);
    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(heading(page)).toHaveText("Settings");
    for (const name of ["Reminders", "Export progress", "Import progress"]) {
      await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Turn on reminders" })).toBeVisible();
    await expect(page.getByLabel("Reminder time (Europe/Berlin)")).toBeVisible();
    await expect(page.getByRole("button", { name: "Export progress" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Import progress" })).toBeVisible();
    await expectTokens(page, [
      [".settings-section", "background-color", "--color-surface"],
      [".settings-section", "border-top-color", "--color-border"],
      [".settings-section .button:not(.button-quiet)", "background-color", "--color-accent"],
      [".settings-section .button:not(.button-quiet)", "color", "--color-accent-text"],
      [".settings-section .button-quiet", "background-color", "--color-surface"],
      [".settings-section .button-quiet", "color", "--color-text"],
      ["#reminder-hour", "font-size", "--font-size-body"],
      [".settings-section p", "font-size", "--font-size-body"],
      [".settings-section h2", "font-family", "--font-family"],
      ["main", "max-width", "--content-max"],
    ]);
    await expectTapTargets(page, ".settings-section .button, #reminder-hour, #import-file, .bar-links a");
    // One column at every width; centred with the max width kept at 768 and 1280.
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const lefts = await page
        .locator(".settings-section")
        .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
      expect(new Set(lefts).size, `${vp.name}: sections stacked in one column`).toBe(1);
      if (vp.width >= 768) {
        const main = await page.locator("main").evaluate((e) => {
          const r = e.getBoundingClientRect();
          return { left: r.left, right: window.innerWidth - r.right, width: r.width };
        });
        expect(Math.abs(main.left - main.right), `${vp.name}: centred`).toBeLessThanOrEqual(1);
        expect(main.width, `${vp.name}: max width kept`).toBeLessThan(vp.width);
      }
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await expectNoSeriousAxeViolations(page);
    await shootAll(page, "settings-default");

    await page.getByLabel("Reminder time (Europe/Berlin)").selectOption("7");
    await page.getByRole("button", { name: "Turn on reminders" }).click();
    await expect(page.getByText("Reminders are on for 07:00.")).toBeVisible();
    expect(mock.subscribed).toEqual([
      {
        subscription: { endpoint: "https://push.example/send/abc", keys: { p256dh: "p256dh-key", auth: "auth-key" } },
        hour: 7,
        timezone: "Europe/Berlin",
      },
    ]);
    await expect(page.getByText("On: every day at 07:00 (Europe/Berlin), only when cards are due.")).toBeVisible();
    await page.getByRole("button", { name: "Turn off reminders" }).click();
    await expect(page.getByText("Reminders are off.")).toBeVisible();
    expect(mock.unsubscribed).toEqual([{ endpoint: "https://push.example/send/abc" }]);
    await expect(page.getByRole("button", { name: "Turn on reminders" })).toBeVisible();
  });

  test("T015 AC 4: permission denied shows the blocked text, asks once, no retry loop", async ({ page, context }) => {
    await page.addInitScript(() => {
      let permission: NotificationPermission = "default";
      const asked = { count: 0 };
      (window as unknown as { asked: typeof asked }).asked = asked;
      Object.defineProperty(Notification, "permission", { get: () => permission });
      Notification.requestPermission = async () => {
        asked.count++;
        permission = "denied";
        return permission;
      };
    });
    const mock = await mockSettings(context, STATUS);
    await signIn(page);
    await page.goto("/settings");
    await page.getByRole("button", { name: "Turn on reminders" }).click();
    await expect(page.getByText("Reminders blocked in browser settings")).toBeVisible();
    await expect(page.getByRole("button", { name: "Turn on reminders" })).toHaveCount(0);
    await page.waitForTimeout(1_000);
    expect(await page.evaluate(() => (window as unknown as { asked: { count: number } }).asked.count)).toBe(1);
    expect(mock.subscribed).toEqual([]);
    await expectNoSeriousAxeViolations(page);
    await shootAll(page, "settings-blocked");
  });

  test("T015 AC 4: a server without push says so; a browser without Notification shows the iOS hint", async ({
    page,
    context,
  }) => {
    await mockSettings(context, { ...STATUS, configured: false, publicKey: null });
    await signIn(page);
    await page.goto("/settings");
    await expect(page.getByText("Reminders are not available on this server")).toBeVisible();
    await expect(page.getByRole("button", { name: "Turn on reminders" })).toHaveCount(0);
    await expect(page.getByText("Add to Home Screen to install and get reminders")).toHaveCount(0);

    await page.addInitScript(() => {
      // Safari on iOS before "Add to Home Screen" has no Notification global.
      delete (window as unknown as { Notification?: unknown }).Notification;
    });
    await page.reload();
    await expect(page.getByText("Add to Home Screen to install and get reminders")).toBeVisible();
    await expect(page.getByRole("button", { name: "Turn on reminders" })).toHaveCount(0);
    await expectNoSeriousAxeViolations(page);
  });

  test("T015 AC 5: Export progress downloads the file from the API", async ({ page, context }) => {
    await mockSettings(context, STATUS);
    await signIn(page);
    await page.goto("/settings");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export progress" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("idea-ladder-progress-2026-11-12.json");
    const path = await file.path();
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ format: "idea-ladder-progress", version: 1 });
    await expect(page.getByText("Downloaded idea-ladder-progress-2026-11-12.json. Keep it as a backup.")).toBeVisible();
  });

  test("T015 AC 6: Import progress shows the counts, each server error detail, and refuses a file over 5 MB", async ({
    page,
    context,
  }) => {
    const result: ImportResult = {
      applied: 3,
      duplicates: 2,
      skipped: { olderThanServer: 1, notRateable: 0, futureTime: 1 },
    };
    const answers = [
      { status: 200, json: result },
      { status: 400, json: { error: "invalid-file", detail: "This is not an Idea Ladder progress file." } },
      { status: 403, json: { error: "wrong-account", detail: "This file belongs to another account (@someone)." } },
      { status: 413, json: { error: "file-too-large", detail: "The file is larger than 5 MB." } },
    ];
    const mock = await mockSettings(context, STATUS, (n) => answers[n] ?? { status: 500, json: {} });
    await signIn(page);
    await page.goto("/settings");
    const input = page.getByRole("button", { name: "Import progress" });
    const pick = (name: string, body: string | Buffer) =>
      input.setInputFiles({ name, mimeType: "application/json", buffer: Buffer.from(body) });
    const messages = page
      .locator(".settings-section")
      .filter({ has: page.getByRole("heading", { name: "Import progress" }) })
      .locator(".settings-ok, .settings-error");

    await pick("progress.json", JSON.stringify({ format: "idea-ladder-progress", version: 1 }));
    await expect(messages).toHaveText([
      "Imported 3 reviews; 2 were already saved. Skipped: 1 older than your saved progress, 1 with a time in the future.",
    ]);
    for (const answer of answers.slice(1)) {
      await pick("bad.json", "{}");
      await expect(messages).toHaveText([(answer.json as { detail: string }).detail]);
      await expect(messages).toHaveAttribute("role", "alert");
      if (answer.status === 400) {
        await expectNoSeriousAxeViolations(page);
        await shootAll(page, "settings-import-error");
      }
    }
    expect(mock.imports).toBe(4);

    await pick("huge.json", Buffer.alloc(5 * 1024 * 1024 + 1, 32));
    await expect(messages).toHaveText(["This file is larger than 5 MB. Choose the file you exported."]);
    await page.waitForTimeout(300);
    expect(mock.imports).toBe(4); // refused before reading or uploading
  });

  test("T015 fix: a 403 import shows the server's detail; the generic text only when there is no detail", async ({
    page,
    context,
  }) => {
    const detail = "This file belongs to another account (@someone). Sign in as @someone to import it.";
    const answers = [
      { status: 403, json: { error: "wrong-account", detail } },
      { status: 403, json: { error: "wrong-account" } },
      { status: 413, json: { error: "file-too-large" } },
    ];
    await mockSettings(context, STATUS, (n) => answers[n] ?? { status: 500, json: {} });
    await signIn(page);
    await page.goto("/settings");
    const input = page.getByRole("button", { name: "Import progress" });
    const message = page.locator("#import-title ~ .settings-error");
    await input.setInputFiles({ name: "a.json", mimeType: "application/json", buffer: Buffer.from("{}") });
    await expect(message).toHaveText(detail);
    for (let n = 1; n < answers.length; n++) {
      await input.setInputFiles({ name: "b.json", mimeType: "application/json", buffer: Buffer.from("{}") });
      await expect(message).toHaveText("Could not import this file. Try again.");
    }
  });
});
