// GitHub OAuth web flow (scope read:user). Base URLs come from config so tests use a local stub.
import type { Config } from "./config.ts";

export type GithubUser = { id: number; login: string };

export function authorizeUrl(config: Config, state: string): string {
  const url = new URL("/login/oauth/authorize", config.githubOauthBaseUrl);
  url.searchParams.set("client_id", config.githubClientId);
  url.searchParams.set("scope", "read:user");
  url.searchParams.set("state", state);
  return url.toString();
}

/** Exchanges the one-time code and reads the account. Throws on any failure; the token is not kept. */
export async function fetchGithubUser(config: Config, code: string): Promise<GithubUser> {
  const tokenRes = await fetch(new URL("/login/oauth/access_token", config.githubOauthBaseUrl), {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ client_id: config.githubClientId, client_secret: config.githubClientSecret, code }),
    signal: AbortSignal.timeout(10_000),
  });
  const token = (await tokenRes.json().catch(() => ({}))) as { access_token?: unknown; error?: unknown };
  if (!tokenRes.ok || typeof token.access_token !== "string") {
    throw new Error(`GitHub token exchange failed: ${String(token.error ?? tokenRes.status)}`);
  }

  const userRes = await fetch(new URL("/user", config.githubApiBaseUrl), {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token.access_token}`,
      "user-agent": "idea-ladder",
    },
    signal: AbortSignal.timeout(10_000),
  });
  const user = (await userRes.json().catch(() => ({}))) as { id?: unknown; login?: unknown };
  if (
    !userRes.ok ||
    !Number.isSafeInteger(user.id) ||
    (user.id as number) <= 0 ||
    typeof user.login !== "string" ||
    !user.login
  ) {
    throw new Error(`GitHub user lookup failed: ${userRes.status}`);
  }
  return { id: user.id as number, login: user.login };
}
