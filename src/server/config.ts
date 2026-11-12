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
  /** Web Push (VAPID) keys; absent = reminders off. Only `publicKey` ever reaches the client; the private key is never logged. */
  vapid?: { publicKey: string; privateKey: string; subject: string };
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

  const limitRaw = env.START_MAX_NEW_JOBS_PER_HOUR || "20";
  const startMaxNewJobsPerHour = /^[1-9][0-9]*$/.test(limitRaw) ? Number(limitRaw) : 0;
  if (!startMaxNewJobsPerHour) problems.push("START_MAX_NEW_JOBS_PER_HOUR must be a positive integer");

  if (env.NODE_ENV === "production") {
    if (env.INNGEST_DEV) problems.push("INNGEST_DEV must not be set in production");
    const missingInngest = ["INNGEST_SIGNING_KEY", "INNGEST_EVENT_KEY", "INNGEST_SERVE_ORIGIN"].filter((n) => !env[n]);
    if (missingInngest.length) problems.push(`production requires: ${missingInngest.join(", ")}`);
  }
  const inngestServeOrigin = env.INNGEST_SERVE_ORIGIN ? url("INNGEST_SERVE_ORIGIN", "") : undefined;

  // Messages name the variable only: a key value is never part of an error.
  const VAPID = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"] as const;
  const vapidMissing = VAPID.filter((n) => !env[n]);
  if (vapidMissing.length > 0 && vapidMissing.length < VAPID.length)
    problems.push(`VAPID push keys: set all three or none (missing: ${vapidMissing.join(", ")})`);
  const base64urlBytes = (value = "") => (/^[A-Za-z0-9_-]+$/.test(value) ? Buffer.from(value, "base64url").length : 0);
  let vapid: Config["vapid"];
  if (!vapidMissing.length) {
    const subject = env.VAPID_SUBJECT as string;
    if (base64urlBytes(env.VAPID_PUBLIC_KEY) !== 65)
      problems.push("VAPID_PUBLIC_KEY must be a base64url P-256 public key");
    if (base64urlBytes(env.VAPID_PRIVATE_KEY) !== 32)
      problems.push("VAPID_PRIVATE_KEY must be a base64url P-256 private key");
    if (!/^mailto:.+@.+/.test(subject) && !/^https:\/\/[^/\s]+/.test(subject))
      problems.push("VAPID_SUBJECT must be a mailto: address or an https URL");
    vapid = { publicKey: env.VAPID_PUBLIC_KEY as string, privateKey: env.VAPID_PRIVATE_KEY as string, subject };
  }

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
    ...(inngestServeOrigin ? { inngestServeOrigin } : {}),
    ...(vapid ? { vapid } : {}),
  };
}
