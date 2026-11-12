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
  /** New generation jobs one learner may create per hour (joins and cache hits do not count). */
  startMaxNewJobsPerHour: number;
  /** Public origin Inngest calls back; never derived from the request Host header. Required in production. */
  inngestServeOrigin?: string;
  /** Model A for the repo reader: always the API back end (Anthropic provider), never the subscription. */
  anthropicApiKey: string;
  modelAId: string;
  readerMaxSteps: number;
  readerTokenBudget: number;
};

export class ConfigError extends Error {}

/** Upper bounds of the reader limits: a typo must not turn the step cap or the token budget into no limit. */
export const READER_LIMIT_MAX = { steps: 50, tokens: 500_000 } as const;

/** A positive integer up to `max`, or null. Shared with the eval subject (eval/src/repo-reader-subject.ts). */
export function parsePositiveInt(raw: string, max: number): number | null {
  if (!/^[1-9][0-9]*$/.test(raw)) return null;
  const n = Number(raw);
  return n <= max ? n : null;
}

const REQUIRED = [
  "DATABASE_URL",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "GITHUB_APP_TOKEN",
  "SESSION_SECRET",
  "ANTHROPIC_API_KEY",
  "MODEL_A_ID",
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

  const limitRaw = env.START_MAX_NEW_JOBS_PER_HOUR || "20";
  const startMaxNewJobsPerHour = /^[1-9][0-9]*$/.test(limitRaw) ? Number(limitRaw) : 0;
  if (!startMaxNewJobsPerHour) problems.push("START_MAX_NEW_JOBS_PER_HOUR must be a positive integer");
  const positive = (name: string, fallback: string, max: number) => {
    const n = parsePositiveInt(env[name] || fallback, max);
    if (n !== null) return n;
    problems.push(`${name} must be a positive integer at most ${max}`);
    return 0;
  };
  const readerMaxSteps = positive("READER_MAX_STEPS", "15", READER_LIMIT_MAX.steps);
  const readerTokenBudget = positive("READER_TOKEN_BUDGET", "80000", READER_LIMIT_MAX.tokens);

  if (env.NODE_ENV === "production") {
    if (env.INNGEST_DEV) problems.push("INNGEST_DEV must not be set in production");
    const missingInngest = ["INNGEST_SIGNING_KEY", "INNGEST_EVENT_KEY", "INNGEST_SERVE_ORIGIN"].filter((n) => !env[n]);
    if (missingInngest.length) problems.push(`production requires: ${missingInngest.join(", ")}`);
  }
  const inngestServeOrigin = env.INNGEST_SERVE_ORIGIN ? url("INNGEST_SERVE_ORIGIN", "") : undefined;

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
    startMaxNewJobsPerHour,
    anthropicApiKey: env.ANTHROPIC_API_KEY as string,
    modelAId: env.MODEL_A_ID as string,
    readerMaxSteps,
    readerTokenBudget,
    ...(inngestServeOrigin ? { inngestServeOrigin } : {}),
  };
}
