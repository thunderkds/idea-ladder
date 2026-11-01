// Test-only GitHub repo API for e2e: serves the recorded T001 fixtures, with switches to hold or rate-limit a repo.
import type { Hono } from 'hono';
import { API, fixtureFetch, rateLimited } from './helpers/github-fixture.js';

const FIXTURES: Record<string, string> = {
  'lukeed/dset': 'lukeed__dset',
  'developit/mitt': 'developit__mitt',
  'the-pocket/pocketflow': 'The-Pocket__PocketFlow',
};

export function addRepoRoutes(app: Hono) {
  const held = new Map<string, { promise: Promise<void>; release: () => void }>();
  const limited = new Map<string, number>();

  app.post('/__stub/hold', async (c) => {
    const { repo } = await c.req.json<{ repo: string }>();
    let release = () => {};
    const promise = new Promise<void>((resolve) => (release = resolve));
    held.set(repo.toLowerCase(), { promise, release });
    return c.json({ ok: true });
  });

  app.post('/__stub/release', async (c) => {
    const { repo } = await c.req.json<{ repo: string }>();
    held.get(repo.toLowerCase())?.release();
    held.delete(repo.toLowerCase());
    return c.json({ ok: true });
  });

  app.post('/__stub/rate-limit', async (c) => {
    const { repo, resetEpochSeconds } = await c.req.json<{ repo: string; resetEpochSeconds: number }>();
    limited.set(repo.toLowerCase(), resetEpochSeconds);
    return c.json({ ok: true });
  });

  // The workflow step's first call is GET /repos/<repo>; the request path only calls /repos/<repo>/commits/HEAD.
  app.get('/repos/:owner/:name/*', (c) => serveRepo(c.req.url));
  app.get('/repos/:owner/:name', (c) => serveRepo(c.req.url));

  async function serveRepo(rawUrl: string): Promise<Response> {
    const url = new URL(rawUrl);
    const path = url.pathname + url.search;
    const repo = url.pathname.split('/').slice(2, 4).join('/').toLowerCase();
    const file = FIXTURES[repo];
    if (!file) return new Response('{"message":"Not Found"}', { status: 404 });
    const isStepStart = url.pathname.toLowerCase() === `/repos/${repo}`;
    if (isStepStart) {
      const reset = limited.get(repo);
      if (reset !== undefined) return rateLimited(reset);
      await held.get(repo)?.promise;
    }
    const gh = fixtureFetch(file);
    return gh.fetch(`${API}${path}`);
  }
}
