export type Config = {
  databaseUrl: string;
  githubClientId: string;
  githubClientSecret: string;
  /** Fine-grained token, public read only: the app's own GitHub API calls (repo reads). Never logged. */
  githubAppToken: string;
  sessionSecret: string;
  githubOauthBaseUrl: string;
  githubApiBaseUrl: string;
  port: number;
  /** Cookies get `Secure` everywhere except local development and tests. */
  secureCookies: boolean;
};

export class ConfigError extends Error {}

const REQUIRED = [
  "DATABASE_URL",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "GITHUB_APP_TOKEN",
  "SESSION_SECRET",
] as const;

/** Validates the environment once at start, so a bad setup fails with variable names, not deep in OAuth code. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const problems: string[] = [];
  const missing = REQUIRED.filter((name) => !env[name]);
  if (missing.length) problems.push(`missing required environment variable(s): ${missing.join(", ")}`);
  if (env.SESSION_SECRET && env.SESSION_SECRET.length < 32)
    problems.push("SESSION_SECRET must be at least 32 characters");

  const url = (name: string, fallback: string) => {
    const value = env[name] || fallback;
    try {
      return new URL(value).origin;
    } catch {
      problems.push(`${name} is not a valid URL`);
      return value;
    }
  };
  const githubOauthBaseUrl = url("GITHUB_OAUTH_BASE_URL", "https://github.com");
  const githubApiBaseUrl = url("GITHUB_API_BASE_URL", "https://api.github.com");
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) problems.push("PORT must be an integer 0-65535");

  if (problems.length) throw new ConfigError(`Invalid configuration: ${problems.join("; ")}`);
  return {
    databaseUrl: env.DATABASE_URL as string,
    githubClientId: env.GITHUB_CLIENT_ID as string,
    githubClientSecret: env.GITHUB_CLIENT_SECRET as string,
    githubAppToken: env.GITHUB_APP_TOKEN as string,
    sessionSecret: env.SESSION_SECRET as string,
    githubOauthBaseUrl,
    githubApiBaseUrl,
    port,
    secureCookies: env.NODE_ENV !== "development" && env.NODE_ENV !== "test",
  };
}
