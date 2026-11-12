import { join } from "node:path";
import type { SQL } from "bun";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { serveStatic } from "hono/bun";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { secureHeaders } from "hono/secure-headers";
import {
  checkState,
  endSession,
  newState,
  SESSION_COOKIE,
  SESSION_MAX_AGE_S,
  STATE_COOKIE,
  STATE_MAX_AGE_S,
  sessionUser,
  signInUser,
} from "./auth.ts";
import type { Config } from "./config.ts";
import { authorizeUrl, fetchGithubUser } from "./github.ts";
import {
  GitHubError,
  type GithubRepoClient,
  githubRepoClient,
  RateLimitError,
  RepoEmptyError,
  RepoNotFoundError,
} from "./github-repo.ts";
import { getLadderView, ladderExists, listLadders, noPasses, type PassedLevels } from "./ladder-view.ts";
import { offlinePack, syncRatings } from "./offline.ts";
import { exportProgress, importProgress, MAX_IMPORT_BYTES, parseProgressFile } from "./progress.ts";
import { checkSubscribe, isEndpoint, pushStatus, subscribe, unsubscribe } from "./push.ts";
import { checkRateRequest, rateCard, reviewQueue } from "./review.ts";
import {
  checkUrl,
  type Enqueue,
  EnqueueError,
  jobForLearner,
  MAX_URL_LENGTH,
  type StartResult,
  startLadder,
  TooManyStartsError,
} from "./start.ts";

const FAILED_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sign-in failed</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body><main><h1>Sign-in failed</h1><p>GitHub sign-in did not complete. No account was changed.</p>
<p><a href="/">Try again</a></p></main></body></html>`;

/** Return target kept across GitHub sign-in: only a same-origin `/start?...`, `/ladders/<id>`, `/review` or `/settings` path is ever stored or followed. */
const RETURN_COOKIE = "il_return_to";
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;
const safeDecode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return "\x00"; // malformed escapes: treat as hostile
  }
};
const LADDER_PATH = /^\/ladders\/[1-9][0-9]{0,17}$/;
const REVIEW_PATH = "/review";
const SETTINGS_PATH = "/settings";
function returnPath(value: string | undefined): string | undefined {
  if (value && (LADDER_PATH.test(value) || value === REVIEW_PATH || value === SETTINGS_PATH)) return value;
  if (!value || value.length > MAX_URL_LENGTH * 4 || !value.startsWith("/start?")) return undefined;
  if (CONTROL_CHARS.test(value) || CONTROL_CHARS.test(safeDecode(value))) return undefined;
  const url = new URL(value, "http://idea-ladder.invalid");
  return url.origin === "http://idea-ladder.invalid" && url.pathname === "/start" ? value : undefined;
}

type Problem = { status: 400 | 404 | 422 | 429 | 502 | 503; error: string; resetAt?: string; retryAt?: string };

/** Maps a start failure to an HTTP problem; anything unknown is re-thrown (500). */
function startProblem(err: unknown): Problem {
  if (err instanceof RepoNotFoundError) return { status: 404, error: "repo-not-found" };
  if (err instanceof RepoEmptyError) return { status: 422, error: "repo-empty" };
  if (err instanceof RateLimitError) return { status: 503, error: "rate-limited", resetAt: err.resetAt.toISOString() };
  if (err instanceof TooManyStartsError) {
    return { status: 429, error: "too-many-starts", retryAt: err.retryAt.toISOString() };
  }
  if (err instanceof EnqueueError) return { status: 503, error: "queue-unavailable" };
  if (err instanceof GitHubError) {
    console.warn("start: GitHub call failed:", err.message);
    return { status: 502, error: "github-unavailable" };
  }
  throw err;
}

export function createApp(opts: {
  config: Config;
  sql: SQL;
  clientDir: string;
  now?: () => number;
  /** Default: the app-token client on GITHUB_API_BASE_URL. */
  github?: GithubRepoClient;
  /** Sends ladder/generate.requested. Default: none configured, so /start answers queue-unavailable. */
  enqueue?: Enqueue;
  /** Levels a learner has passed on a ladder. Default: none (T012 supplies the real one). */
  passedLevels?: PassedLevels;
  /** Inngest serve handler, mounted at /api/inngest. */
  inngestHandler?: (c: Context) => Promise<Response>;
}) {
  const { config, sql, clientDir } = opts;
  const github = opts.github ?? githubRepoClient({ baseUrl: config.githubApiBaseUrl, token: config.githubAppToken });
  const enqueue: Enqueue =
    opts.enqueue ??
    (async () => {
      throw new Error("no Inngest client configured");
    });
  const passedLevels = opts.passedLevels ?? noPasses;
  const now = opts.now ?? Date.now;
  const secret = config.sessionSecret;
  const cookieBase = { httpOnly: true, sameSite: "Lax", secure: config.secureCookies, path: "/" } as const;
  const indexHtml = () => Bun.file(join(clientDir, "index.html")).text();
  const currentUser = (c: Parameters<typeof getCookie>[0]) => sessionUser(sql, secret, getCookie(c, SESSION_COOKIE));

  const app = new Hono();
  app.use(secureHeaders());
  // Per-user and auth responses must never be stored by browsers or shared caches.
  for (const path of [
    "/ladders",
    "/ladders/*",
    "/api/ladders",
    "/api/ladders/*",
    "/api/me",
    "/auth/*",
    "/start",
    "/api/start",
    "/api/jobs/*",
    "/jobs/*",
    REVIEW_PATH,
    "/api/review/*",
    "/api/push/*",
    "/api/progress/*",
    SETTINGS_PATH,
  ]) {
    app.use(path, async (c, next) => {
      await next();
      c.res.headers.set("Cache-Control", "no-store");
    });
  }

  app.get("/", async (c) => ((await currentUser(c)) ? c.redirect("/ladders", 302) : c.html(await indexHtml())));

  app.get("/ladders", async (c) => ((await currentUser(c)) ? c.html(await indexHtml()) : c.redirect("/", 302)));

  app.get("/api/ladders", async (c) => {
    const user = await currentUser(c);
    return user ? c.json(await listLadders(sql, user.userId)) : c.json({ error: "unauthorized" }, 401);
  });

  app.get("/api/ladders/:ladderId", async (c) => {
    const user = await currentUser(c);
    if (!user) return c.json({ error: "unauthorized" }, 401);
    const view = await getLadderView(sql, c.req.param("ladderId"), user.userId, passedLevels);
    return view ? c.json(view) : c.json({ error: "not-found" }, 404);
  });

  // The client page; an unknown id still gets the client (it draws the 404 page) with status 404.
  app.get("/ladders/:ladderId", async (c) => {
    const ladderId = c.req.param("ladderId");
    const user = await currentUser(c);
    if (!user) {
      const next = LADDER_PATH.test(`/ladders/${ladderId}`)
        ? `?next=${encodeURIComponent(`/ladders/${ladderId}`)}`
        : "";
      return c.redirect(`/auth/github${next}`, 302);
    }
    return c.html(await indexHtml(), (await ladderExists(sql, ladderId)) ? 200 : 404);
  });

  app.get("/api/me", async (c) => {
    const user = await currentUser(c);
    return user ? c.json({ login: user.githubLogin }) : c.json({ error: "unauthorized" }, 401);
  });

  app.get("/auth/github", (c) => {
    const { state, cookie } = newState(secret, now());
    setCookie(c, STATE_COOKIE, cookie, { ...cookieBase, maxAge: STATE_MAX_AGE_S });
    const next = returnPath(c.req.query("next"));
    if (next) setCookie(c, RETURN_COOKIE, next, { ...cookieBase, maxAge: STATE_MAX_AGE_S });
    return c.redirect(authorizeUrl(config, state), 302);
  });

  app.get("/auth/github/callback", async (c) => {
    const stateCookie = getCookie(c, STATE_COOKIE);
    deleteCookie(c, STATE_COOKIE, cookieBase); // one use only, success or not
    const returnTo = returnPath(getCookie(c, RETURN_COOKIE));
    deleteCookie(c, RETURN_COOKIE, cookieBase);
    const fail = () => c.html(FAILED_PAGE, 400);
    const code = c.req.query("code");
    if (c.req.query("error") || !code) return fail();
    if (!checkState(secret, stateCookie, c.req.query("state"), now())) return fail();
    let token: string;
    try {
      token = await signInUser(sql, secret, await fetchGithubUser(config, code));
    } catch (err) {
      console.warn("sign-in failed:", err instanceof Error ? err.message : err);
      return fail();
    }
    setCookie(c, SESSION_COOKIE, token, { ...cookieBase, maxAge: SESSION_MAX_AGE_S });
    return c.redirect(returnTo ?? "/ladders", 302);
  });

  app.post("/auth/sign-out", async (c) => {
    await endSession(sql, secret, getCookie(c, SESSION_COOKIE));
    deleteCookie(c, SESSION_COOKIE, cookieBase);
    return c.redirect("/", 303);
  });

  // The client page with a problem code for /start; codes and the ISO time are fixed strings, never user input.
  const startPage = async (c: Context, p: Problem) => {
    const attrs =
      `data-error="${p.error}"` +
      (p.resetAt ? ` data-reset-at="${p.resetAt}"` : "") +
      (p.retryAt ? ` data-retry-at="${p.retryAt}"` : "");
    return c.html((await indexHtml()).replace('<div id="root">', `<div id="root" ${attrs}>`), p.status);
  };
  const runStart = async (userId: string, input: unknown): Promise<StartResult | Problem> => {
    const ref = checkUrl(input);
    if (typeof ref === "string") return { status: 400, error: ref };
    try {
      return await startLadder({ sql, github, enqueue, maxNewJobsPerHour: config.startMaxNewJobsPerHour }, userId, ref);
    } catch (err) {
      return startProblem(err);
    }
  };

  // Browser contract (Idea Radar links and pasted URLs).
  app.get("/start", async (c) => {
    const input = c.req.query("url");
    const ref = checkUrl(input);
    if (typeof ref === "string") return startPage(c, { status: 400, error: ref });
    const user = await currentUser(c);
    if (!user) {
      const here = new URL(c.req.url);
      return c.redirect(`/auth/github?next=${encodeURIComponent(here.pathname + here.search)}`, 302);
    }
    const result = await runStart(user.userId, input);
    if ("ladderId" in result) return c.redirect(`/ladders/${result.ladderId}`, 302);
    if ("jobId" in result) return c.redirect(`/jobs/${result.jobId}`, 302);
    return startPage(c, result);
  });

  app.post("/api/start", async (c) => {
    const user = await currentUser(c);
    if (!user) return c.json({ error: "unauthorized" }, 401);
    const body = (await c.req.json().catch(() => undefined)) as { url?: unknown } | undefined;
    if (!body || typeof body !== "object") return c.json({ error: "bad-request" }, 400);
    const result = await runStart(user.userId, body.url);
    if ("ladderId" in result) return c.json({ ladderId: result.ladderId }, 200);
    if ("jobId" in result) return c.json({ jobId: result.jobId }, 202);
    const { status, ...problem } = result;
    return c.json(problem, status);
  });

  app.get("/api/jobs/:jobId", async (c) => {
    const user = await currentUser(c);
    if (!user) return c.json({ error: "unauthorized" }, 401);
    const job = await jobForLearner(sql, c.req.param("jobId"), user.userId);
    return job ? c.json(job) : c.json({ error: "not-found" }, 404);
  });

  app.get("/jobs/:jobId", async (c) => ((await currentUser(c)) ? c.html(await indexHtml()) : c.redirect("/", 302)));

  app.get(REVIEW_PATH, async (c) =>
    (await currentUser(c))
      ? c.html(await indexHtml())
      : c.redirect(`/auth/github?next=${encodeURIComponent(REVIEW_PATH)}`, 302),
  );

  // T011: the server owns the schedule; `now()` is the only review time.
  app.get("/api/review/queue", async (c) => {
    const user = await currentUser(c);
    if (!user) return c.json({ error: "unauthorized" }, 401);
    return c.json(await reviewQueue(sql, user.userId, new Date(now()), passedLevels));
  });

  app.post("/api/review/rate", async (c) => {
    const user = await currentUser(c);
    if (!user) return c.json({ error: "unauthorized" }, 401);
    const req = checkRateRequest(await c.req.json().catch(() => undefined));
    if (!req) return c.json({ error: "invalid-request" }, 400);
    const result = await rateCard(sql, user.userId, req, new Date(now()), passedLevels);
    return result ? c.json(result) : c.json({ error: "not-found" }, 404);
  });

  // T015: the cards to review offline, and the ratings queued while offline (each applied through rateCard).
  app.get("/api/review/offline-pack", async (c) => {
    const user = await currentUser(c);
    if (!user) return c.json({ error: "unauthorized" }, 401);
    return c.json(await offlinePack(sql, user.userId, new Date(now()), passedLevels));
  });

  app.post("/api/review/sync", async (c) => {
    const user = await currentUser(c);
    if (!user) return c.json({ error: "unauthorized" }, 401);
    const body = await c.req.json().catch(() => undefined);
    const result = await syncRatings(sql, user.userId, body, new Date(now()), passedLevels);
    return typeof result === "string" ? c.json({ error: result }, 400) : c.json(result);
  });

  app.get(SETTINGS_PATH, async (c) =>
    (await currentUser(c))
      ? c.html(await indexHtml())
      : c.redirect(`/auth/github?next=${encodeURIComponent(SETTINGS_PATH)}`, 302),
  );

  // T015: the progress file. Import is size-checked before it is read or parsed, then validated whole before any write.
  app.get("/api/progress/export", async (c) => {
    const user = await currentUser(c);
    if (!user) return c.json({ error: "unauthorized" }, 401);
    const at = new Date(now());
    c.header(
      "Content-Disposition",
      `attachment; filename="idea-ladder-progress-${at.toISOString().slice(0, 10)}.json"`,
    );
    return c.json(await exportProgress(sql, user.userId, at, passedLevels));
  });

  const tooLarge = (c: Context) => c.json({ error: "file-too-large" }, 413);
  app.post("/api/progress/import", bodyLimit({ maxSize: MAX_IMPORT_BYTES, onError: tooLarge }), async (c) => {
    const user = await currentUser(c);
    if (!user) return c.json({ error: "unauthorized" }, 401);
    const text = await c.req.text();
    if (Buffer.byteLength(text) > MAX_IMPORT_BYTES) return tooLarge(c);
    const [me] = await sql`SELECT github_id::int AS github_id FROM users WHERE id = ${user.userId}`;
    const file = parseProgressFile(text, me.github_id);
    if ("status" in file) return c.json(file.body, file.status);
    return c.json(await importProgress(sql, user.userId, file, new Date(now()), passedLevels));
  });

  // T015: push reminders. Only the VAPID public key ever reaches a client.
  app.get("/api/push/status", async (c) => {
    const user = await currentUser(c);
    if (!user) return c.json({ error: "unauthorized" }, 401);
    return c.json(await pushStatus(sql, user.userId, config.vapid?.publicKey));
  });

  app.post("/api/push/subscribe", async (c) => {
    const user = await currentUser(c);
    if (!user) return c.json({ error: "unauthorized" }, 401);
    if (!config.vapid) return c.json({ error: "push-not-configured", configured: false }, 503);
    const req = checkSubscribe(await c.req.json().catch(() => undefined));
    if (!req) return c.json({ error: "invalid-request" }, 400);
    await subscribe(sql, user.userId, req);
    return c.json({ ok: true });
  });

  app.post("/api/push/unsubscribe", async (c) => {
    const user = await currentUser(c);
    if (!user) return c.json({ error: "unauthorized" }, 401);
    const body = (await c.req.json().catch(() => undefined)) as { endpoint?: unknown } | undefined;
    if (!body || typeof body !== "object" || !isEndpoint(body.endpoint))
      return c.json({ error: "invalid-request" }, 400);
    await unsubscribe(sql, user.userId, body.endpoint);
    return c.json({ ok: true });
  });

  if (opts.inngestHandler) app.on(["GET", "POST", "PUT"], "/api/inngest", opts.inngestHandler);

  app.use("/*", serveStatic({ root: clientDir }));
  return app;
}
