export interface Config {
  databaseUrl: string;
  githubClientId: string;
  githubClientSecret: string;
  sessionSecret: string;
  githubOauthBaseUrl: string;
  githubApiBaseUrl: string;
  /** Token for the app's own GitHub reads (public repos only). Optional: without it GitHub's low unauthenticated limit applies. */
  githubAppToken: string | undefined;
  appBaseUrl: string;
  port: number;
  secureCookies: boolean;
  /** Web Push (VAPID) keys. Undefined when unset: reminders are then off. The private key is never sent to the client. */
  vapid: { publicKey: string; privateKey: string; subject: string } | undefined;
}

export class ConfigError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Invalid configuration: ${problems.join('; ')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

const REQUIRED = ['DATABASE_URL', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'SESSION_SECRET'] as const;

function isLocalUrl(url: string): boolean {
  const host = new URL(url).hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const problems: string[] = [];
  for (const name of REQUIRED) {
    if (!env[name]) problems.push(`${name} is missing`);
  }
  const secret = env.SESSION_SECRET;
  if (secret && secret.length < 32) problems.push('SESSION_SECRET must be at least 32 characters');
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) problems.push('PORT must be an integer from 1 to 65535');
  const appBaseUrl = (env.APP_BASE_URL ?? `http://localhost:${port}`).replace(/\/$/, '');
  try {
    new URL(appBaseUrl);
  } catch {
    problems.push('APP_BASE_URL is not a valid URL');
  }
  const vapidNames = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'] as const;
  const vapidSet = vapidNames.filter((name) => env[name]);
  if (vapidSet.length > 0 && vapidSet.length < vapidNames.length) {
    problems.push(`${vapidNames.filter((name) => !env[name]).join(', ')} missing: set all three VAPID variables or none`);
  }
  const subject = env.VAPID_SUBJECT;
  if (subject && !/^(mailto:|https:\/\/)/.test(subject)) problems.push('VAPID_SUBJECT must start with mailto: or https://');
  if (problems.length > 0) throw new ConfigError(problems);

  return {
    databaseUrl: env.DATABASE_URL as string,
    githubClientId: env.GITHUB_CLIENT_ID as string,
    githubClientSecret: env.GITHUB_CLIENT_SECRET as string,
    sessionSecret: env.SESSION_SECRET as string,
    githubOauthBaseUrl: (env.GITHUB_OAUTH_BASE_URL ?? 'https://github.com').replace(/\/$/, ''),
    githubApiBaseUrl: (env.GITHUB_API_BASE_URL ?? 'https://api.github.com').replace(/\/$/, ''),
    githubAppToken: env.GITHUB_APP_TOKEN || undefined,
    appBaseUrl,
    port,
    secureCookies: !isLocalUrl(appBaseUrl),
    vapid:
      vapidSet.length === vapidNames.length
        ? { publicKey: env.VAPID_PUBLIC_KEY as string, privateKey: env.VAPID_PRIVATE_KEY as string, subject: subject as string }
        : undefined,
  };
}
