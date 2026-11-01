import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

interface Entry {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export const API = 'https://api.github.com';

export function loadFixture(file: string): Record<string, Entry> {
  const path = fileURLToPath(new URL(`../fixtures/github/${file}.json`, import.meta.url));
  return (JSON.parse(readFileSync(path, 'utf8')) as { entries: Record<string, Entry> }).entries;
}

export interface FixtureFetch {
  fetch: typeof fetch;
  /** Every request path (without the host) in order. */
  calls: string[];
}

/**
 * A fetch that serves the responses recorded in T001 for one repo (test/fixtures/github/<owner>__<name>.json).
 * The recorded set has no `commits/HEAD` call (the T001 code read `commits/<branch>`), so that one answer is
 * derived from the recorded `commits/<branch>` body. Anything not recorded answers 404 and shows up in `calls`.
 * `intercept` runs first and may answer instead (to simulate rate limits and 5xx).
 */
export function fixtureFetch(
  file: string,
  intercept?: (path: string, callNumber: number) => Response | undefined,
): FixtureFetch {
  const entries = loadFixture(file);
  const byPath = new Map(Object.entries(entries).map(([url, e]) => [url.slice(API.length).toLowerCase(), e]));
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    const path = String(input).slice(API.length);
    calls.push(path);
    const intercepted = intercept?.(path, calls.length);
    if (intercepted) return intercepted;

    const headMatch = /^\/repos\/([^/]+\/[^/]+)\/commits\/HEAD$/i.exec(path);
    if (headMatch) {
      const branchKey = [...byPath.keys()].find((k) => /\/commits\/[^/?]+$/.test(k));
      const sha = branchKey ? (byPath.get(branchKey) as Entry).body.trim() : undefined;
      if (!sha) return new Response('{}', { status: 404 });
      const canonical = (branchKey as string).split('/commits/')[0]?.replace(/^\/repos\//, '');
      return Response.json({ sha, html_url: `https://github.com/${canonical}/commit/${sha}` });
    }
    const entry = byPath.get(path.toLowerCase());
    if (!entry) return new Response('{"message":"Not Found"}', { status: 404 });
    return new Response(entry.body, { status: entry.status, headers: entry.headers });
  }) as typeof fetch;
  return { fetch: impl, calls };
}

export function rateLimited(resetEpochSeconds: number): Response {
  return new Response('{"message":"API rate limit exceeded"}', {
    status: 403,
    headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(resetEpochSeconds) },
  });
}

export const SHAS = {
  mitt: '6b41670516ed8e8b738612f60491995470aa63b3',
  dset: '05b1ec0f8cebe3b5d5667285bc7da90f38a7215e',
  pocketflow: 'f74d023f93607b8c3268133339a5e532a949898c',
} as const;
