import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { secureHeaders } from 'hono/secure-headers';
import { serve as serveInngest } from 'inngest/hono';
import type pg from 'pg';
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, STATE_COOKIE, STATE_MAX_AGE_SECONDS, STATE_PATH } from './auth/cookies.js';
import { authorizeUrl, fetchGithubUser } from './auth/github.js';
import { createSession, deleteSession, findSession, upsertUser } from './auth/session.js';
import { issueState, verifyState } from './auth/state.js';
import type { Config } from './config.js';
import { type GithubOptions } from './start/github.js';
import { getLadderView, listMyLadders } from './ladder/view.js';
import { findLadderId, getJob } from './start/jobs.js';
import { parseRepoUrl, UnsupportedUrlError } from './start/repo-url.js';
import { type Enqueue, StartError, type StartErrorCode, startLadder } from './start/service.js';
import { HomePage, JobPage, LadderPage, LaddersPage, MessagePage, UnsupportedUrlPage } from './views.js';
import { createLadderGenerate, inngest, sendLadderRequested } from './workflow/ladder-generate.js';

const MAX_URL_LENGTH = 2048;
export const RETURN_COOKIE = 'il_return';
export const RETURN_LADDER_COOKIE = 'il_return_ladder';
const LADDER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RETURN_MAX_AGE_SECONDS = 600;

const START_ERRORS: Record<StartErrorCode, { status: 404 | 422 | 502 | 503; message: string }> = {
  'repo-not-found': { status: 404, message: 'GitHub has no public repository with that name. Private repos do not work yet.' },
  'repo-empty': { status: 422, message: 'That repository has no commits yet, so there is nothing to learn from.' },
  'rate-limited': { status: 503, message: 'GitHub is limiting requests right now. Please try again in a few minutes.' },
  'github-unavailable': { status: 502, message: 'GitHub did not answer. Please try again in a moment.' },
  'enqueue-failed': { status: 503, message: 'The job could not be started. Please try again in a moment.' },
};

export interface AppDeps {
  config: Config;
  pool: pg.Pool;
  fetchImpl?: typeof fetch;
  /** Sends the ladder/generate.requested event. Defaults to the Inngest client; tests pass a spy. */
  enqueue?: Enqueue;
}

export function createApp({ config, pool, fetchImpl, enqueue = sendLadderRequested }: AppDeps) {
  const app = new Hono();
  const github: GithubOptions = { baseUrl: config.githubApiBaseUrl, token: config.githubAppToken, fetchImpl };
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
    // Back to /start?url=... when the learner came from there. The target is rebuilt, never copied from the cookie.
    const returnUrl = getCookie(c, RETURN_COOKIE);
    deleteCookie(c, RETURN_COOKIE, { path: '/', secure: config.secureCookies });
    // Back to /ladders/:id when the learner came from there. Only a UUID is accepted, and the path is rebuilt.
    const returnLadder = getCookie(c, RETURN_LADDER_COOKIE);
    deleteCookie(c, RETURN_LADDER_COOKIE, { path: '/', secure: config.secureCookies });
    if (!returnUrl && returnLadder && LADDER_ID.test(returnLadder)) return c.redirect(`/ladders/${returnLadder.toLowerCase()}`, 302);
    if (returnUrl && returnUrl.length <= MAX_URL_LENGTH) return c.redirect(`/start?url=${encodeURIComponent(returnUrl)}`, 302);
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
    return c.html(<LaddersPage login={session.githubLogin} ladders={await listMyLadders(pool, session.userId)} />);
  });

  app.get('/ladders/:ladderId', async (c) => {
    c.header('cache-control', 'no-store');
    const ladderId = c.req.param('ladderId');
    const session = await findSession(pool, config.sessionSecret, getCookie(c, SESSION_COOKIE));
    if (!session) {
      if (LADDER_ID.test(ladderId)) setCookie(c, RETURN_LADDER_COOKIE, ladderId, { ...cookieBase, path: '/', maxAge: RETURN_MAX_AGE_SECONDS });
      return c.redirect('/auth/github', 302);
    }
    const ladder = await getLadderView(pool, ladderId, session.userId);
    if (!ladder) return c.html(<MessagePage heading="Ladder not found" message="This ladder does not exist." />, 404);
    return c.html(<LadderPage login={session.githubLogin} ladder={ladder} />);
  });

  app.on(['GET', 'POST', 'PUT'], '/api/inngest', serveInngest({ client: inngest, functions: [createLadderGenerate(pool, github)] }));

  function startErrorResponse(err: StartError) {
    const { status, message } = START_ERRORS[err.code];
    return { status, message, resetAt: err.resetAt };
  }

  app.get('/start', async (c) => {
    c.header('cache-control', 'no-store');
    const url = c.req.query('url');
    if (!url) return c.html(<MessagePage heading="No repository given" message="Add ?url=<GitHub repository URL> to this page address." />, 400);
    if (url.length > MAX_URL_LENGTH) {
      return c.html(<MessagePage heading="That URL is too long" message="Use a GitHub repository URL under 2,048 characters." />, 400);
    }
    const session = await findSession(pool, config.sessionSecret, getCookie(c, SESSION_COOKIE));
    if (!session) {
      setCookie(c, RETURN_COOKIE, url, { ...cookieBase, path: '/', maxAge: RETURN_MAX_AGE_SECONDS });
      return c.redirect('/auth/github', 302);
    }
    let repo;
    try {
      repo = parseRepoUrl(url);
    } catch (err) {
      if (err instanceof UnsupportedUrlError) return c.html(<UnsupportedUrlPage url={url} />, 400);
      throw err;
    }
    try {
      const result = await startLadder({ pool, github, enqueue }, repo, session.userId);
      return c.redirect(result.kind === 'hit' ? `/ladders/${result.ladderId}` : `/jobs/${result.jobId}`, 302);
    } catch (err) {
      if (!(err instanceof StartError)) throw err;
      const { status, message } = startErrorResponse(err);
      return c.html(<MessagePage heading="Could not start" message={message} />, status);
    }
  });

  app.post('/api/start', async (c) => {
    c.header('cache-control', 'no-store');
    const session = await findSession(pool, config.sessionSecret, getCookie(c, SESSION_COOKIE));
    if (!session) return c.json({ error: 'unauthenticated' }, 401);
    // JSON only: a cross-site form cannot send this content type, so a cookie alone cannot start a job.
    if (!(c.req.header('content-type') ?? '').toLowerCase().startsWith('application/json')) {
      return c.json({ error: 'content-type-must-be-json' }, 415);
    }
    const body = await c.req.json<{ url?: unknown }>().catch(() => null);
    if (typeof body?.url !== 'string' || body.url === '') return c.json({ error: 'missing-url' }, 400);
    if (body.url.length > MAX_URL_LENGTH) return c.json({ error: 'url-too-long' }, 400);
    let repo;
    try {
      repo = parseRepoUrl(body.url);
    } catch (err) {
      if (err instanceof UnsupportedUrlError) return c.json({ error: 'unsupported-url' }, 422);
      throw err;
    }
    try {
      const result = await startLadder({ pool, github, enqueue }, repo, session.userId);
      return result.kind === 'hit' ? c.json({ ladderId: result.ladderId }, 200) : c.json({ jobId: result.jobId }, 202);
    } catch (err) {
      if (!(err instanceof StartError)) throw err;
      const { status, resetAt } = startErrorResponse(err);
      if (resetAt) c.header('retry-after', String(Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000))));
      return c.json({ error: err.code, ...(resetAt ? { resetAt: resetAt.toISOString() } : {}) }, status);
    }
  });

  // Any signed-in learner can read a job: ids are random and a job only carries a public repo's name and status.
  app.get('/api/jobs/:jobId', async (c) => {
    c.header('cache-control', 'no-store');
    const session = await findSession(pool, config.sessionSecret, getCookie(c, SESSION_COOKIE));
    if (!session) return c.json({ error: 'unauthenticated' }, 401);
    const job = await getJob(pool, c.req.param('jobId'));
    if (!job) return c.json({ error: 'job-not-found' }, 404);
    const ladderId = await findLadderId(pool, job.repoFullName, job.commitSha);
    return c.json({
      status: job.status,
      ...(job.reason ? { reason: job.reason } : {}),
      ...(job.resetAt ? { resetAt: job.resetAt.toISOString() } : {}),
      ...(ladderId ? { ladderId } : {}),
    });
  });

  app.get('/jobs/:jobId', async (c) => {
    c.header('cache-control', 'no-store');
    const session = await findSession(pool, config.sessionSecret, getCookie(c, SESSION_COOKIE));
    if (!session) return c.redirect('/', 302);
    const job = await getJob(pool, c.req.param('jobId'));
    if (!job) return c.html(<MessagePage heading="Job not found" message="This job does not exist." />, 404);
    return c.html(<JobPage job={{ id: job.id, repoFullName: job.repoFullName, status: job.status, reason: job.reason, resetAt: job.resetAt }} />);
  });

  app.onError((err, c) => {
    console.error(err);
    return c.html(<MessagePage heading="Something went wrong" message="Please try again in a moment." />, 500);
  });

  return app;
}
