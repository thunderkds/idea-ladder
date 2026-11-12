import { join } from "node:path";
import type { SQL } from "bun";
import { type Context, Hono } from "hono";
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

/** Return target kept across GitHub sign-in: only a same-origin `/start?...` path is ever stored or followed. */
const RETURN_COOKIE = "il_return_to";
function startPath(value: string | undefined): string | undefined {
  if (!value || value.length > MAX_URL_LENGTH * 4 || !value.startsWith("/start?")) return undefined;
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
  const now = opts.now ?? Date.now;
  const secret = config.sessionSecret;
  const cookieBase = { httpOnly: true, sameSite: "Lax", secure: config.secureCookies, path: "/" } as const;
  const indexHtml = () => Bun.file(join(clientDir, "index.html")).text();
  const currentUser = (c: Parameters<typeof getCookie>[0]) => sessionUser(sql, secret, getCookie(c, SESSION_COOKIE));

  const app = new Hono();
  app.use(secureHeaders());
  // Per-user and auth responses must never be stored by browsers or shared caches.
  for (const path of ["/ladders", "/api/me", "/auth/*", "/start", "/api/start", "/api/jobs/*", "/jobs/*"]) {
    app.use(path, async (c, next) => {
      await next();
      c.res.headers.set("Cache-Control", "no-store");
    });
  }

  app.get("/", async (c) => ((await currentUser(c)) ? c.redirect("/ladders", 302) : c.html(await indexHtml())));

  app.get("/ladders", async (c) => ((await currentUser(c)) ? c.html(await indexHtml()) : c.redirect("/", 302)));

  app.get("/api/me", async (c) => {
    const user = await currentUser(c);
    return user ? c.json({ login: user.githubLogin }) : c.json({ error: "unauthorized" }, 401);
  });

  app.get("/auth/github", (c) => {
    const { state, cookie } = newState(secret, now());
    setCookie(c, STATE_COOKIE, cookie, { ...cookieBase, maxAge: STATE_MAX_AGE_S });
    const next = startPath(c.req.query("next"));
    if (next) setCookie(c, RETURN_COOKIE, next, { ...cookieBase, maxAge: STATE_MAX_AGE_S });
    return c.redirect(authorizeUrl(config, state), 302);
  });

  app.get("/auth/github/callback", async (c) => {
    const stateCookie = getCookie(c, STATE_COOKIE);
    deleteCookie(c, STATE_COOKIE, cookieBase); // one use only, success or not
    const returnTo = startPath(getCookie(c, RETURN_COOKIE));
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

  if (opts.inngestHandler) app.on(["GET", "POST", "PUT"], "/api/inngest", opts.inngestHandler);

  app.use("/*", serveStatic({ root: clientDir }));
  return app;
}
