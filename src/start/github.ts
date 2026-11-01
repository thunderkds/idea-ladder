export interface GithubOptions {
  baseUrl: string;
  /** Never logged, never put in an error message. */
  token?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
}

export interface TreeEntry {
  path: string;
  type: 'file' | 'dir' | 'other';
}

export interface RepoSnapshot {
  sha: string;
  defaultBranch: string;
  archived: boolean;
  readme: string;
  topics: string[];
  languages: Record<string, number>;
  depFiles: string[];
  /** Open issues, pull requests excluded. Counted from the first page (max 100). */
  openIssues: number;
  /** Open issues labelled "good first issue" (first page, max 100). */
  goodFirstIssues: number;
  /** Root directory listing at the pinned SHA. Deeper reading is the repo reader's job (T006). */
  tree: TreeEntry[];
}

export class RateLimitError extends Error {
  constructor(public readonly resetAt: Date) {
    super(`GitHub rate limit exhausted; resets at ${resetAt.toISOString()}`);
    this.name = 'RateLimitError';
  }
}

export class RepoNotFoundError extends Error {
  constructor(public readonly fullName: string) {
    super(`GitHub repo not found: ${fullName}`);
    this.name = 'RepoNotFoundError';
  }
}

export class RepoEmptyError extends Error {
  constructor(public readonly fullName: string) {
    super(`GitHub repo has no commits: ${fullName}`);
    this.name = 'RepoEmptyError';
  }
}

export class GitHubError extends Error {
  constructor(
    public readonly status: number,
    path: string,
  ) {
    super(`GitHub API ${status} for ${path}`);
    this.name = 'GitHubError';
  }
}

const FULL_NAME = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const SHA = /^[0-9a-f]{40}$/;
const DEP_FILES = new Set([
  'package.json', 'requirements.txt', 'pyproject.toml', 'setup.py', 'Pipfile',
  'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle', 'Gemfile', 'composer.json', 'deno.json',
]);

export async function get(opts: GithubOptions, path: string): Promise<Response> {
  const headers: Record<string, string> = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const res = await (opts.fetchImpl ?? fetch)(`${opts.baseUrl}${path}`, { headers, redirect: 'follow' });
  if (res.status === 403 || res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after'));
    if (res.headers.get('x-ratelimit-remaining') === '0') {
      throw new RateLimitError(new Date(Number(res.headers.get('x-ratelimit-reset') ?? '0') * 1000));
    }
    if (Number.isFinite(retryAfter) && retryAfter > 0) throw new RateLimitError(new Date(Date.now() + retryAfter * 1000));
  }
  return res;
}

async function getJson<T>(opts: GithubOptions, path: string): Promise<T> {
  const res = await get(opts, path);
  if (!res.ok) throw new GitHubError(res.status, path);
  return (await res.json()) as T;
}

/**
 * The request path: ONE call. Returns the head commit of the default branch and the canonical
 * lower-cased `owner/name` (GitHub redirects a renamed repo; the commit's html_url carries the new name).
 */
export async function resolveHead(opts: GithubOptions, owner: string, name: string): Promise<{ sha: string; fullName: string }> {
  const path = `/repos/${owner}/${name}/commits/HEAD`;
  const res = await get(opts, path);
  if (res.status === 404) throw new RepoNotFoundError(`${owner}/${name}`);
  if (res.status === 409) throw new RepoEmptyError(`${owner}/${name}`);
  if (!res.ok) throw new GitHubError(res.status, path);
  const body = (await res.json()) as { sha?: string; html_url?: string };
  if (typeof body.sha !== 'string' || !SHA.test(body.sha)) throw new GitHubError(502, path);
  let fullName = `${owner}/${name}`;
  try {
    const m = /^\/([^/]+)\/([^/]+)\/commit\/[0-9a-f]{40}$/.exec(new URL(body.html_url ?? '').pathname);
    if (m) fullName = `${m[1]}/${m[2]}`;
  } catch {
    // no usable html_url: keep the name the learner gave
  }
  return { sha: body.sha, fullName: fullName.toLowerCase() };
}

/**
 * The workflow step: reads one repo at a pinned SHA. All-or-nothing: any error throws, no partial snapshot.
 * Calls: repo, readme, languages, contents, issues, good-first-issues = 6.
 */
export async function fetchRepoSnapshot(opts: GithubOptions, fullName: string, sha: string): Promise<RepoSnapshot> {
  if (!FULL_NAME.test(fullName) || fullName.split('/').some((p) => p === '.' || p === '..') || !SHA.test(sha)) throw new Error(`expected owner/name and a 40-hex sha, got: ${fullName} ${sha}`);
  const repoPath = `/repos/${fullName}`;

  const repoRes = await get(opts, repoPath);
  if (repoRes.status === 404) throw new RepoNotFoundError(fullName);
  if (!repoRes.ok) throw new GitHubError(repoRes.status, repoPath);
  const repo = (await repoRes.json()) as { default_branch: string; topics?: string[]; archived?: boolean };

  const readmePath = `${repoPath}/readme?ref=${sha}`;
  const readmeRes = await get(opts, readmePath);
  let readme = '';
  if (readmeRes.status !== 404) {
    if (!readmeRes.ok) throw new GitHubError(readmeRes.status, readmePath);
    readme = Buffer.from(((await readmeRes.json()) as { content: string }).content, 'base64').toString('utf8');
  }

  const languages = await getJson<Record<string, number>>(opts, `${repoPath}/languages`);
  const contents = await getJson<Array<{ name: string; type: string }>>(opts, `${repoPath}/contents/?ref=${sha}`);
  const tree = contents.map((e): TreeEntry => ({ path: e.name, type: e.type === 'file' ? 'file' : e.type === 'dir' ? 'dir' : 'other' }));
  const depFiles = tree.filter((e) => e.type === 'file' && DEP_FILES.has(e.path)).map((e) => e.path);

  const issues = await getJson<Array<{ pull_request?: unknown }>>(opts, `${repoPath}/issues?state=open&per_page=100`);
  const gfi = await getJson<Array<{ pull_request?: unknown }>>(
    opts,
    `${repoPath}/issues?state=open&per_page=100&labels=${encodeURIComponent('good first issue')}`,
  );

  return {
    sha,
    defaultBranch: repo.default_branch,
    archived: repo.archived === true,
    readme,
    topics: repo.topics ?? [],
    languages,
    depFiles,
    openIssues: issues.filter((i) => !i.pull_request).length,
    goodFirstIssues: gfi.filter((i) => !i.pull_request).length,
    tree,
  };
}
