import type pg from 'pg';
import { SESSION_MAX_AGE_SECONDS } from './cookies.js';
import { hmacHex, randomToken } from './crypto.js';
import type { GithubUser } from './github.js';

export interface SessionUser {
  userId: string;
  githubLogin: string;
}

/** Identity key is the GitHub numeric id; the login is only a label and is refreshed on every sign-in. */
export async function upsertUser(pool: pg.Pool, user: GithubUser): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (github_id, github_login) VALUES ($1, $2)
     ON CONFLICT (github_id) DO UPDATE SET github_login = EXCLUDED.github_login, updated_at = now()
     RETURNING id`,
    [user.id, user.login],
  );
  return (rows[0] as { id: string }).id;
}

export async function createSession(pool: pg.Pool, secret: string, userId: string): Promise<string> {
  const token = randomToken(32);
  await pool.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))`,
    [userId, hmacHex(secret, token), SESSION_MAX_AGE_SECONDS],
  );
  return token;
}

export async function findSession(pool: pg.Pool, secret: string, token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const { rows } = await pool.query<{ user_id: string; github_login: string }>(
    `SELECT s.user_id, u.github_login FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hmacHex(secret, token)],
  );
  const row = rows[0];
  return row ? { userId: row.user_id, githubLogin: row.github_login } : null;
}

export async function deleteSession(pool: pg.Pool, secret: string, token: string | undefined): Promise<void> {
  if (!token) return;
  await pool.query('DELETE FROM sessions WHERE token_hash = $1', [hmacHex(secret, token)]);
}
