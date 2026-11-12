// OAuth state cookie and server-side sessions.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { SQL } from "bun";
import type { GithubUser } from "./github.ts";

export const STATE_COOKIE = "il_oauth_state";
export const SESSION_COOKIE = "il_session";
export const STATE_MAX_AGE_S = 600;
export const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;

const hmac = (secret: string, value: string) => createHmac("sha256", secret).update(value).digest("hex");

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Random state plus a signed cookie value `state.issuedAtMs.hmac`, so age cannot be forged. */
export function newState(secret: string, nowMs: number): { state: string; cookie: string } {
  const state = randomBytes(32).toString("base64url");
  const payload = `${state}.${nowMs}`;
  return { state, cookie: `${payload}.${hmac(secret, `state:${payload}`)}` };
}

/** True only if the cookie is untampered, younger than STATE_MAX_AGE_S, and matches the query state. */
export function checkState(
  secret: string,
  cookie: string | undefined,
  queryState: string | undefined,
  nowMs: number,
): boolean {
  if (!cookie || !queryState) return false;
  const [state, issuedAt, mac, ...rest] = cookie.split(".");
  if (!state || !issuedAt || !mac || rest.length) return false;
  if (!safeEqual(mac, hmac(secret, `state:${state}.${issuedAt}`))) return false;
  const age = nowMs - Number(issuedAt);
  if (!Number.isFinite(age) || age < 0 || age > STATE_MAX_AGE_S * 1000) return false;
  return safeEqual(state, queryState);
}

/** Upserts by GitHub numeric id (never by login) and opens a session. Returns the cookie token. */
export async function signInUser(sql: SQL, secret: string, user: GithubUser): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await sql.begin(async (tx) => {
    const [row] = await tx`
      INSERT INTO users (github_id, github_login) VALUES (${user.id}, ${user.login})
      ON CONFLICT (github_id) DO UPDATE SET github_login = EXCLUDED.github_login, updated_at = now()
      RETURNING id`;
    await tx`
      INSERT INTO sessions (id, user_id, expires_at)
      VALUES (${hmac(secret, `session:${token}`)}, ${row.id}, now() + make_interval(secs => ${SESSION_MAX_AGE_S}))`;
  });
  return token;
}

export type SessionUser = { userId: string; githubLogin: string };

export async function sessionUser(
  sql: SQL,
  secret: string,
  token: string | undefined,
): Promise<SessionUser | undefined> {
  if (!token) return undefined;
  const [row] = await sql`
    SELECT u.id::text AS user_id, u.github_login FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id = ${hmac(secret, `session:${token}`)} AND s.expires_at > now()`;
  return row ? { userId: row.user_id, githubLogin: row.github_login } : undefined;
}

export async function endSession(sql: SQL, secret: string, token: string | undefined): Promise<void> {
  if (token) await sql`DELETE FROM sessions WHERE id = ${hmac(secret, `session:${token}`)}`;
}
