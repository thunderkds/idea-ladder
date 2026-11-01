export interface RepoSnapshot {
  sha: string;
  defaultBranch: string;
  readme: string;
  topics: string[];
  languages: Record<string, number>;
  depFiles: string[];
  /** Open issues, pull requests excluded. Counted from the first page (max 100). */
  openIssues: number;
  /** Open issues labelled "good first issue" (first page, max 100). */
  goodFirstIssues: number;
}

export class RateLimitError extends Error {
  constructor(public readonly resetAt: Date) {
    super(`GitHub rate limit exhausted; resets at ${resetAt.toISOString()}`);
    this.name = "RateLimitError";
  }
}

export class RepoNotFoundError extends Error {
  constructor(public readonly fullName: string) {
    super(`GitHub repo not found: ${fullName}`);
    this.name = "RepoNotFoundError";
  }
}

export class GitHubError extends Error {
  constructor(public readonly status: number, url: string) {
    super(`GitHub API ${status} for ${url}`);
    this.name = "GitHubError";
  }
}

const API = "https://api.github.com";
const DEP_FILES = new Set([
  "package.json", "requirements.txt", "pyproject.toml", "setup.py", "Pipfile",
  "Cargo.toml", "go.mod", "pom.xml", "build.gradle", "Gemfile", "composer.json", "deno.json",
]);

async function get(fetchImpl: typeof fetch, url: string, accept = "application/vnd.github+json"): Promise<Response> {
  const res = await fetchImpl(url, { headers: { accept, "x-github-api-version": "2022-11-28" } });
  if ((res.status === 403 || res.status === 429) && res.headers.get("x-ratelimit-remaining") === "0") {
    throw new RateLimitError(new Date(Number(res.headers.get("x-ratelimit-reset") ?? "0") * 1000));
  }
  return res;
}

async function getJson<T>(fetchImpl: typeof fetch, url: string): Promise<T> {
  const res = await get(fetchImpl, url);
  if (!res.ok) throw new GitHubError(res.status, url);
  return (await res.json()) as T;
}

/**
 * Reads one repo and pins it to a commit SHA. All-or-nothing: any error throws, no partial snapshot.
 * Calls: repo, commit, readme, languages, contents, issues, good-first-issues = 7 (<= 20).
 */
export async function fetchRepoSnapshot(fullName: string, fetchImpl: typeof fetch = fetch): Promise<RepoSnapshot> {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)) throw new Error(`expected owner/name, got: ${fullName}`);
  const repoUrl = `${API}/repos/${fullName}`;

  const repoRes = await get(fetchImpl, repoUrl);
  if (repoRes.status === 404) throw new RepoNotFoundError(fullName);
  if (!repoRes.ok) throw new GitHubError(repoRes.status, repoUrl);
  const repo = (await repoRes.json()) as { default_branch: string; topics?: string[] };
  const defaultBranch = repo.default_branch;

  const shaUrl = `${repoUrl}/commits/${encodeURIComponent(defaultBranch)}`;
  const shaRes = await get(fetchImpl, shaUrl, "application/vnd.github.sha");
  if (!shaRes.ok) throw new GitHubError(shaRes.status, shaUrl);
  const sha = (await shaRes.text()).trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`unexpected commit sha from ${shaUrl}`);

  const readmeUrl = `${repoUrl}/readme?ref=${sha}`;
  const readmeRes = await get(fetchImpl, readmeUrl);
  let readme = "";
  if (readmeRes.status !== 404) {
    if (!readmeRes.ok) throw new GitHubError(readmeRes.status, readmeUrl);
    const body = (await readmeRes.json()) as { content: string };
    readme = Buffer.from(body.content, "base64").toString("utf8");
  }

  const languages = await getJson<Record<string, number>>(fetchImpl, `${repoUrl}/languages`);
  const contents = await getJson<Array<{ name: string; type: string }>>(fetchImpl, `${repoUrl}/contents/?ref=${sha}`);
  const depFiles = contents.filter((e) => e.type === "file" && DEP_FILES.has(e.name)).map((e) => e.name);

  const issues = await getJson<Array<{ pull_request?: unknown }>>(fetchImpl, `${repoUrl}/issues?state=open&per_page=100`);
  const openIssues = issues.filter((i) => !i.pull_request).length;
  const gfi = await getJson<Array<{ pull_request?: unknown }>>(
    fetchImpl,
    `${repoUrl}/issues?state=open&per_page=100&labels=${encodeURIComponent("good first issue")}`,
  );
  const goodFirstIssues = gfi.filter((i) => !i.pull_request).length;

  return { sha, defaultBranch, readme, topics: repo.topics ?? [], languages, depFiles, openIssues, goodFirstIssues };
}
