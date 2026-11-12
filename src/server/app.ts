import { join } from "node:path";
import type { SQL } from "bun";
import { Hono } from "hono";
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

const FAILED_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sign-in failed</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body><main><h1>Sign-in failed</h1><p>GitHub sign-in did not complete. No account was changed.</p>
<p><a href="/">Try again</a></p></main></body></html>`;

export function createApp(opts: { config: Config; sql: SQL; clientDir: string; now?: () => number }) {
  const { config, sql, clientDir } = opts;
  const now = opts.now ?? Date.now;
  const secret = config.sessionSecret;
  const cookieBase = { httpOnly: true, sameSite: "Lax", secure: config.secureCookies, path: "/" } as const;
  const indexHtml = () => Bun.file(join(clientDir, "index.html")).text();
  const currentUser = (c: Parameters<typeof getCookie>[0]) => sessionUser(sql, secret, getCookie(c, SESSION_COOKIE));

  const app = new Hono();
  app.use(secureHeaders());

  app.get("/", async (c) => ((await currentUser(c)) ? c.redirect("/ladders", 302) : c.html(await indexHtml())));

  app.get("/ladders", async (c) => ((await currentUser(c)) ? c.html(await indexHtml()) : c.redirect("/", 302)));

  app.get("/api/me", async (c) => {
    const user = await currentUser(c);
    return user ? c.json({ login: user.githubLogin }) : c.json({ error: "unauthorized" }, 401);
  });

  app.get("/auth/github", (c) => {
    const { state, cookie } = newState(secret, now());
    setCookie(c, STATE_COOKIE, cookie, { ...cookieBase, maxAge: STATE_MAX_AGE_S });
    return c.redirect(authorizeUrl(config, state), 302);
  });

  app.get("/auth/github/callback", async (c) => {
    const stateCookie = getCookie(c, STATE_COOKIE);
    deleteCookie(c, STATE_COOKIE, cookieBase); // one use only, success or not
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
    return c.redirect("/ladders", 302);
  });

  app.post("/auth/sign-out", async (c) => {
    await endSession(sql, secret, getCookie(c, SESSION_COOKIE));
    deleteCookie(c, SESSION_COOKIE, cookieBase);
    return c.redirect("/", 303);
  });

  app.use("/*", serveStatic({ root: clientDir }));
  return app;
}
