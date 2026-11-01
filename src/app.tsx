import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { secureHeaders } from 'hono/secure-headers';
import type pg from 'pg';
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, STATE_COOKIE, STATE_MAX_AGE_SECONDS, STATE_PATH } from './auth/cookies.js';
import { authorizeUrl, fetchGithubUser } from './auth/github.js';
import { createSession, deleteSession, findSession, upsertUser } from './auth/session.js';
import { issueState, verifyState } from './auth/state.js';
import type { Config } from './config.js';
import { HomePage, LaddersPage, MessagePage } from './views.js';

export interface AppDeps {
  config: Config;
  pool: pg.Pool;
  fetchImpl?: typeof fetch;
}

export function createApp({ config, pool, fetchImpl }: AppDeps) {
  const app = new Hono();
  const cookieBase = { httpOnly: true, sameSite: 'Lax', secure: config.secureCookies } as const;

  app.use(secureHeaders());
  app.use('/assets/*', serveStatic({ root: './public', rewriteRequestPath: (p) => p.replace(/^\/assets/, '') }));

  app.get('/', async (c) => {
    if (await findSession(pool, config.sessionSecret, getCookie(c, SESSION_COOKIE))) return c.redirect('/ladders', 302);
    return c.html(<HomePage />);
  });

  app.get('/auth/github', (c) => {
    const { state, cookieValue } = issueState(config.sessionSecret);
    setCookie(c, STATE_COOKIE, cookieValue, { ...cookieBase, path: STATE_PATH, maxAge: STATE_MAX_AGE_SECONDS });
    return c.redirect(authorizeUrl(config, state), 302);
  });

  app.get('/auth/github/callback', async (c) => {
    const stateCookie = getCookie(c, STATE_COOKIE);
    deleteCookie(c, STATE_COOKIE, { path: STATE_PATH, secure: config.secureCookies });
    const fail = (heading: string, message: string) => {
      c.header('cache-control', 'no-store');
      return c.html(<MessagePage heading={heading} message={message} />, 400);
    };

    const state = c.req.query('state');
    if (!verifyState(config.sessionSecret, stateCookie, state)) {
      return fail('Sign in failed', 'The sign-in request was not valid or has expired. Please try again.');
    }
    if (c.req.query('error')) return fail('Sign in was cancelled', 'GitHub did not grant access. You can try again.');
    const code = c.req.query('code');
    if (!code) return fail('Sign in failed', 'GitHub did not send a sign-in code. Please try again.');

    let user;
    try {
      user = await fetchGithubUser(config, code, fetchImpl);
    } catch {
      return fail('Sign in failed', 'GitHub could not confirm your sign-in. Please try again.');
    }
    const userId = await upsertUser(pool, user);
    const token = await createSession(pool, config.sessionSecret, userId);
    setCookie(c, SESSION_COOKIE, token, { ...cookieBase, path: '/', maxAge: SESSION_MAX_AGE_SECONDS });
    return c.redirect('/ladders', 302);
  });

  app.post('/auth/sign-out', async (c) => {
    await deleteSession(pool, config.sessionSecret, getCookie(c, SESSION_COOKIE));
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: config.secureCookies });
    return c.redirect('/', 303);
  });

  app.get('/ladders', async (c) => {
    const session = await findSession(pool, config.sessionSecret, getCookie(c, SESSION_COOKIE));
    if (!session) return c.redirect('/', 302);
    c.header('cache-control', 'no-store');
    return c.html(<LaddersPage login={session.githubLogin} />);
  });

  app.onError((err, c) => {
    console.error(err);
    return c.html(<MessagePage heading="Something went wrong" message="Please try again in a moment." />, 500);
  });

  return app;
}
