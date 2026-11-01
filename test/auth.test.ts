import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { SESSION_COOKIE, STATE_COOKIE } from '../src/auth/cookies.js';
import { issueState } from '../src/auth/state.js';
import { loadConfig } from '../src/config.js';
import { createTempDb, runMigrate, type TempDb } from './helpers/db.js';
import { startStub } from './stub-github.js';

const SECRET = 's'.repeat(48);
let db: TempDb;
let pool: pg.Pool;
let stub: Awaited<ReturnType<typeof startStub>>;
let app: ReturnType<typeof createApp>;

async function count(table: 'users' | 'sessions'): Promise<number> {
  return Number((await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n);
}

function setCookies(res: Response): string[] {
  return res.headers.getSetCookie();
}
function cookieValue(res: Response, name: string): string | undefined {
  const line = setCookies(res).find((c) => c.startsWith(`${name}=`));
  return line?.split(';')[0]?.slice(name.length + 1);
}

async function begin() {
  const res = await app.request('/auth/github');
  const location = new URL(res.headers.get('location') as string);
  return { res, location, state: location.searchParams.get('state') as string, stateCookie: cookieValue(res, STATE_COOKIE) };
}

async function signIn(user: { id: number; login: string }) {
  const { state, stateCookie } = await begin();
  const code = stub.issueCode(user);
  const res = await app.request(`/auth/github/callback?code=${code}&state=${state}`, {
    headers: { cookie: `${STATE_COOKIE}=${stateCookie}` },
  });
  return { res, code, state, stateCookie, session: cookieValue(res, SESSION_COOKIE) };
}

beforeAll(async () => {
  db = await createTempDb();
  await runMigrate(db.url, 'up');
  pool = new pg.Pool({ connectionString: db.url });
  stub = await startStub({ clientId: 'test-client', clientSecret: 'test-secret' });
  const config = loadConfig({
    DATABASE_URL: db.url,
    GITHUB_CLIENT_ID: 'test-client',
    GITHUB_CLIENT_SECRET: 'test-secret',
    SESSION_SECRET: SECRET,
    GITHUB_OAUTH_BASE_URL: stub.baseUrl,
    GITHUB_API_BASE_URL: stub.baseUrl,
    APP_BASE_URL: 'http://localhost:3000',
  });
  app = createApp({ config, pool });
});
afterAll(async () => {
  await pool.end();
  await stub.close();
  await db.drop();
});

describe('sign-in start', () => {
  it('shows a Sign in with GitHub button when signed out', async () => {
    const res = await app.request('/');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Sign in with GitHub');
    expect(html).toContain('<button');
  });

  it('redirects to the authorize URL with client_id, random state and scope read:user only', async () => {
    const a = await begin();
    const b = await begin();
    expect(a.res.status).toBe(302);
    expect(a.location.origin).toBe(stub.baseUrl);
    expect(a.location.pathname).toBe('/login/oauth/authorize');
    expect(a.location.searchParams.get('client_id')).toBe('test-client');
    expect(a.location.searchParams.get('scope')).toBe('read:user');
    expect(a.location.searchParams.get('redirect_uri')).toBe('http://localhost:3000/auth/github/callback');
    expect(a.state).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(a.state).not.toBe(b.state);
    const line = setCookies(a.res).find((c) => c.startsWith(`${STATE_COOKIE}=`)) as string;
    expect(line).toMatch(/HttpOnly/i);
    expect(line).toMatch(/SameSite=Lax/i);
    expect(line).toMatch(/Max-Age=\d+/i);
  });
});

describe('callback success', () => {
  it('upserts the user, sets a session cookie and shows the empty My ladders page', async () => {
    const { res, session } = await signIn({ id: 42, login: 'octo' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/ladders');
    const line = setCookies(res).find((c) => c.startsWith(`${SESSION_COOKIE}=`)) as string;
    expect(line).toMatch(/HttpOnly/i);
    expect(line).toMatch(/SameSite=Lax/i);
    expect(line).not.toMatch(/Secure/i);
    expect(session).toBeTruthy();
    expect((await pool.query('SELECT github_id, github_login FROM users WHERE github_id = 42')).rows).toEqual([
      { github_id: '42', github_login: 'octo' },
    ]);
    // the raw token is never stored
    expect((await pool.query('SELECT token_hash FROM sessions')).rows.map((r) => r.token_hash)).not.toContain(session);

    const page = await app.request('/ladders', { headers: { cookie: `${SESSION_COOKIE}=${session}` } });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('My ladders');
    expect(html).toContain('No ladders yet');
    expect(html).toContain('octo');
  });

  it('marks the session cookie Secure when the app base URL is not local', async () => {
    const secureApp = createApp({
      config: loadConfig({
        DATABASE_URL: db.url,
        GITHUB_CLIENT_ID: 'test-client',
        GITHUB_CLIENT_SECRET: 'test-secret',
        SESSION_SECRET: SECRET,
        GITHUB_OAUTH_BASE_URL: stub.baseUrl,
        GITHUB_API_BASE_URL: stub.baseUrl,
        APP_BASE_URL: 'https://ladder.example',
      }),
      pool,
    });
    const start = await secureApp.request('/auth/github');
    const state = new URL(start.headers.get('location') as string).searchParams.get('state');
    const stateCookie = cookieValue(start, STATE_COOKIE);
    const res = await secureApp.request(`/auth/github/callback?code=${stub.issueCode({ id: 7, login: 'sec' })}&state=${state}`, {
      headers: { cookie: `${STATE_COOKIE}=${stateCookie}` },
    });
    expect(setCookies(res).find((c) => c.startsWith(`${SESSION_COOKIE}=`))).toMatch(/Secure/i);
  });
});

describe('callback rejects forged or failed sign-ins', () => {
  async function expectRejected(res: Response, usersBefore: number, sessionsBefore: number) {
    expect(res.status).toBe(400);
    expect(setCookies(res).some((c) => c.startsWith(`${SESSION_COOKIE}=`) && !/Max-Age=0/i.test(c))).toBe(false);
    expect(cookieValue(res, SESSION_COOKIE)).toBeFalsy();
    expect(await count('users')).toBe(usersBefore);
    expect(await count('sessions')).toBe(sessionsBefore);
  }

  it('mismatched state', async () => {
    const [u, s] = [await count('users'), await count('sessions')];
    const { stateCookie } = await begin();
    const code = stub.issueCode({ id: 900, login: 'forger' });
    const res = await app.request(`/auth/github/callback?code=${code}&state=not-the-state`, {
      headers: { cookie: `${STATE_COOKIE}=${stateCookie}` },
    });
    await expectRejected(res, u, s);
  });

  it('missing state param', async () => {
    const [u, s] = [await count('users'), await count('sessions')];
    const { stateCookie } = await begin();
    const res = await app.request(`/auth/github/callback?code=${stub.issueCode({ id: 901, login: 'x' })}`, {
      headers: { cookie: `${STATE_COOKIE}=${stateCookie}` },
    });
    await expectRejected(res, u, s);
  });

  it('missing state cookie', async () => {
    const [u, s] = [await count('users'), await count('sessions')];
    const { state } = await begin();
    const res = await app.request(`/auth/github/callback?code=${stub.issueCode({ id: 902, login: 'x' })}&state=${state}`);
    await expectRejected(res, u, s);
  });

  it('expired state cookie', async () => {
    const [u, s] = [await count('users'), await count('sessions')];
    const old = issueState(SECRET, Date.now() - 11 * 60 * 1000);
    const res = await app.request(`/auth/github/callback?code=${stub.issueCode({ id: 903, login: 'x' })}&state=${old.state}`, {
      headers: { cookie: `${STATE_COOKIE}=${old.cookieValue}` },
    });
    await expectRejected(res, u, s);
  });

  it('state cookie signed with another secret', async () => {
    const [u, s] = [await count('users'), await count('sessions')];
    const other = issueState('o'.repeat(48));
    const res = await app.request(`/auth/github/callback?code=${stub.issueCode({ id: 904, login: 'x' })}&state=${other.state}`, {
      headers: { cookie: `${STATE_COOKIE}=${other.cookieValue}` },
    });
    await expectRejected(res, u, s);
  });

  it('failed token exchange (unknown code)', async () => {
    const [u, s] = [await count('users'), await count('sessions')];
    const { state, stateCookie } = await begin();
    const res = await app.request(`/auth/github/callback?code=unknown&state=${state}`, {
      headers: { cookie: `${STATE_COOKIE}=${stateCookie}` },
    });
    await expectRejected(res, u, s);
  });

  it('GitHub error=access_denied shows a friendly page and no session', async () => {
    const [u, s] = [await count('users'), await count('sessions')];
    const { state, stateCookie } = await begin();
    const res = await app.request(`/auth/github/callback?error=access_denied&state=${state}`, {
      headers: { cookie: `${STATE_COOKIE}=${stateCookie}` },
    });
    await expectRejected(res, u, s);
    expect(await res.text()).toContain('Sign in was cancelled');
  });

  it('replaying the same code and state creates no second session', async () => {
    const first = await signIn({ id: 55, login: 'replay' });
    expect(first.res.status).toBe(302);
    const sessions = await count('sessions');
    const users = await count('users');
    const again = await app.request(`/auth/github/callback?code=${first.code}&state=${first.state}`, {
      headers: { cookie: `${STATE_COOKIE}=${first.stateCookie}` },
    });
    await expectRejected(again, users, sessions);
  });
});

describe('identity binding', () => {
  it('keeps one row per github_id after a login rename and updates github_login', async () => {
    await signIn({ id: 77, login: 'before-rename' });
    await signIn({ id: 77, login: 'octo-renamed' });
    const rows = (await pool.query('SELECT github_login FROM users WHERE github_id = 77')).rows;
    expect(rows).toEqual([{ github_login: 'octo-renamed' }]);
  });

  it('two accounts get two rows and each session shows only its own login', async () => {
    const a = await signIn({ id: 101, login: 'alice' });
    const b = await signIn({ id: 102, login: 'bob' });
    const pageA = await (await app.request('/ladders', { headers: { cookie: `${SESSION_COOKIE}=${a.session}` } })).text();
    const pageB = await (await app.request('/ladders', { headers: { cookie: `${SESSION_COOKIE}=${b.session}` } })).text();
    expect(pageA).toContain('alice');
    expect(pageA).not.toContain('bob');
    expect(pageB).toContain('bob');
    expect(pageB).not.toContain('alice');
  });
});

describe('session guard', () => {
  it('redirects /ladders to / with 302 when signed out', async () => {
    const res = await app.request('/ladders');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');
  });

  it('rejects an unknown session cookie', async () => {
    const res = await app.request('/ladders', { headers: { cookie: `${SESSION_COOKIE}=forged` } });
    expect(res.status).toBe(302);
  });

  it('sign-out ends the session: the old cookie no longer opens /ladders', async () => {
    const { session } = await signIn({ id: 303, login: 'leaver' });
    const cookie = `${SESSION_COOKIE}=${session}`;
    expect((await app.request('/ladders', { headers: { cookie } })).status).toBe(200);
    const out = await app.request('/auth/sign-out', { method: 'POST', headers: { cookie } });
    expect(out.status).toBe(303);
    expect(out.headers.get('location')).toBe('/');
    const after = await app.request('/ladders', { headers: { cookie } });
    expect(after.status).toBe(302);
    expect(after.headers.get('location')).toBe('/');
  });
});
