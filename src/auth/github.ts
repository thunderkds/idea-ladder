import type { Config } from '../config.js';

export class OAuthError extends Error {}

export interface GithubUser {
  id: string;
  login: string;
}

type FetchLike = typeof fetch;

export function authorizeUrl(config: Config, state: string): string {
  const url = new URL(`${config.githubOauthBaseUrl}/login/oauth/authorize`);
  url.searchParams.set('client_id', config.githubClientId);
  url.searchParams.set('redirect_uri', `${config.appBaseUrl}/auth/github/callback`);
  url.searchParams.set('scope', 'read:user');
  url.searchParams.set('state', state);
  return url.toString();
}

/** Exchanges the code for a token, reads the user, and drops the token. The token is never stored. */
export async function fetchGithubUser(config: Config, code: string, fetchImpl: FetchLike = fetch): Promise<GithubUser> {
  try {
    const tokenRes = await fetchImpl(`${config.githubOauthBaseUrl}/login/oauth/access_token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        client_id: config.githubClientId,
        client_secret: config.githubClientSecret,
        code,
        redirect_uri: `${config.appBaseUrl}/auth/github/callback`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const token = (await tokenRes.json()) as { access_token?: unknown; error?: unknown };
    if (!tokenRes.ok || typeof token.access_token !== 'string') throw new OAuthError('token exchange failed');

    const userRes = await fetchImpl(`${config.githubApiBaseUrl}/user`, {
      headers: { authorization: `Bearer ${token.access_token}`, accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10_000),
    });
    const user = (await userRes.json()) as { id?: unknown; login?: unknown };
    if (!userRes.ok || !Number.isSafeInteger(user.id) || typeof user.login !== 'string' || user.login === '') {
      throw new OAuthError('user lookup failed');
    }
    return { id: String(user.id), login: user.login };
  } catch (e) {
    throw e instanceof OAuthError ? e : new OAuthError('GitHub request failed');
  }
}
