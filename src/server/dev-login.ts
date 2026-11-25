// T034: local dev sign-in as DEV_LOGIN_GITHUB_LOGIN, no OAuth app. loadConfig allows it only with NODE_ENV=development.
import type { Config } from "./config.ts";
import type { GithubUser } from "./github.ts";

/**
 * Looks up the configured login with the app's own token and returns GitHub's numeric id and canonical login.
 * Throws on any failure (fail closed); the error names only the HTTP status, never the token or the body.
 */
export async function devLoginUser(config: Config): Promise<GithubUser> {
  const login = config.devLoginGithubLogin;
  if (!login) throw new Error("dev sign-in is not configured");
  const res = await fetch(new URL(`/users/${encodeURIComponent(login)}`, config.githubApiBaseUrl), {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${config.githubAppToken}`,
      "user-agent": "idea-ladder",
    },
    signal: AbortSignal.timeout(10_000),
  });
  const user = ((await res.json().catch(() => undefined)) ?? {}) as { id?: unknown; login?: unknown };
  if (
    !res.ok ||
    !Number.isSafeInteger(user.id) ||
    (user.id as number) <= 0 ||
    typeof user.login !== "string" ||
    user.login.toLowerCase() !== login.toLowerCase()
  ) {
    throw new Error(`GitHub account lookup failed: ${res.status}`);
  }
  return { id: user.id as number, login: user.login };
}
