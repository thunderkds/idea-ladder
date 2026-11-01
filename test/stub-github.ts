// Test-only stand-in for GitHub's OAuth and API. Never used outside tests and e2e.
import { randomBytes } from 'node:crypto';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';

export interface StubUser {
  id: number;
  login: string;
}

export interface StubOptions {
  clientId: string;
  clientSecret: string;
}

export function createStub(opts: StubOptions) {
  const codes = new Map<string, StubUser>();
  const tokens = new Map<string, StubUser>();
  let currentUser: StubUser = { id: 42, login: 'octo' };
  let denyNext = false;

  function issueCode(user: StubUser): string {
    const code = randomBytes(8).toString('hex');
    codes.set(code, user);
    return code;
  }

  const app = new Hono();

  app.get('/login/oauth/authorize', (c) => {
    const redirectUri = c.req.query('redirect_uri');
    const state = c.req.query('state') ?? '';
    if (c.req.query('client_id') !== opts.clientId || !redirectUri) return c.text('bad request', 400);
    const target = new URL(redirectUri);
    target.searchParams.set('state', state);
    if (denyNext) {
      denyNext = false;
      target.searchParams.set('error', 'access_denied');
    } else {
      target.searchParams.set('code', issueCode(currentUser));
    }
    return c.redirect(target.toString(), 302);
  });

  app.post('/login/oauth/access_token', async (c) => {
    const body = await c.req.json<{ code?: string; client_id?: string; client_secret?: string }>();
    const user = body.code ? codes.get(body.code) : undefined;
    if (!user || body.client_id !== opts.clientId || body.client_secret !== opts.clientSecret) {
      return c.json({ error: 'bad_verification_code' });
    }
    codes.delete(body.code as string);
    const token = randomBytes(12).toString('hex');
    tokens.set(token, user);
    return c.json({ access_token: token, token_type: 'bearer', scope: 'read:user' });
  });

  app.get('/user', (c) => {
    const token = (c.req.header('authorization') ?? '').replace(/^Bearer /, '');
    const user = tokens.get(token);
    return user ? c.json(user) : c.json({ message: 'Bad credentials' }, 401);
  });

  app.post('/__stub/user', async (c) => {
    currentUser = await c.req.json<StubUser>();
    return c.json({ ok: true });
  });

  app.post('/__stub/deny', (c) => {
    denyNext = true;
    return c.json({ ok: true });
  });

  return { app, issueCode, setUser: (u: StubUser) => (currentUser = u) };
}

export async function startStub(opts: StubOptions, port = 0) {
  const stub = createStub(opts);
  const info = await new Promise<{ port: number }>((resolve) => {
    const server = serve({ fetch: stub.app.fetch, port, hostname: '127.0.0.1' }, (i) => resolve(i));
    (stub as unknown as { server: unknown }).server = server;
  });
  const server = (stub as unknown as { server: { close: (cb: () => void) => void } }).server;
  return {
    ...stub,
    baseUrl: `http://127.0.0.1:${info.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
