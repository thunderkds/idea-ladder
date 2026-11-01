// Pattern copied from experiments/core-spike/src/github.ts, extended with the git tree (T004 AC 3).
export interface RepoSnapshot {
  fullName: string;
  sha: string;
  defaultBranch: string;
  readme: string;
  /** Root path of the README in the tree, or "" if none. */
  readmePath: string;
  topics: string[];
  languages: Record<string, number>;
  /** Root-level dependency files present in the tree. */
  depFiles: string[];
  /** Raw text of the dependency files the baseline reads (package.json, Cargo.toml, go.mod). */
  depFileContents: Record<string, string>;
  /** Blob paths at the pinned SHA (directories dropped). */
  tree: string[];
  /** GitHub reported `truncated: true`: the tree is incomplete. Recorded, never hidden. */
  treeTruncated: boolean;
  /** Open issues, pull requests excluded; first page only (max 100). */
  openIssues: number;
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
    super(`GitHub ${status} for ${url}`);
    this.name = "GitHubError";
  }
}

export const API = "https://api.github.com";
export const RAW = "https://raw.githubusercontent.com";
export const DEP_FILES = new Set([
  "package.json", "requirements.txt", "pyproject.toml", "setup.py", "Pipfile",
  "Cargo.toml", "go.mod", "pom.xml", "build.gradle", "Gemfile", "composer.json", "deno.json",
]);
const ENTRY_POINT_FILES = ["package.json", "Cargo.toml", "go.mod"];

export interface FetchOptions { sha?: string; token?: string }

async function get(fetchImpl: typeof fetch, url: string, token?: string, accept = "application/vnd.github+json"): Promise<Response> {
  const headers: Record<string, string> = { accept, "x-github-api-version": "2022-11-28" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetchImpl(url, { headers });
  if ((res.status === 403 || res.status === 429) && res.headers.get("x-ratelimit-remaining") === "0") {
    throw new RateLimitError(new Date(Number(res.headers.get("x-ratelimit-reset") ?? "0") * 1000));
  }
  return res;
}

async function getJson<T>(fetchImpl: typeof fetch, url: string, token?: string): Promise<T> {
  const res = await get(fetchImpl, url, token);
  if (!res.ok) throw new GitHubError(res.status, url);
  return (await res.json()) as T;
}

const rawUrl = (fullName: string, sha: string, path: string) =>
  `${RAW}/${fullName}/${sha}/${path.split("/").map(encodeURIComponent).join("/")}`;

async function getRawText(fetchImpl: typeof fetch, url: string): Promise<string | undefined> {
  const res = await fetchImpl(url);
  if (res.status === 404) return undefined;
  if (!res.ok) throw new GitHubError(res.status, url);
  return res.text();
}

/** Prefers README.md, then any other root README.* by name order. */
export function findReadme(tree: string[]): string {
  const roots = tree.filter((p) => !p.includes("/") && /^readme(\.[^.]+)?$/i.test(p)).sort();
  return roots.find((p) => /\.md$/i.test(p)) ?? roots[0] ?? "";
}

/**
 * Reads one repo at a commit SHA. All-or-nothing: any error throws and no snapshot exists.
 * API calls: repo, commit (skipped when `sha` is pinned), tree, languages, issues = 4-5.
 * Open and good-first-issue counts both come from the first page of open issues (max 100): exact when a repo has <= 100 open issues.
 * README and dependency files come from raw.githubusercontent.com at the SHA (not counted against the API limit).
 */
export async function fetchRepoSnapshot(fullName: string, fetchImpl: typeof fetch = fetch, opts: FetchOptions = {}): Promise<RepoSnapshot> {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)) throw new Error(`expected owner/name, got: ${fullName}`);
  const repoUrl = `${API}/repos/${fullName}`;
  const tok = opts.token;

  const repoRes = await get(fetchImpl, repoUrl, tok);
  if (repoRes.status === 404) throw new RepoNotFoundError(fullName);
  if (!repoRes.ok) throw new GitHubError(repoRes.status, repoUrl);
  const repo = (await repoRes.json()) as { default_branch: string; topics?: string[] };
  const defaultBranch = repo.default_branch;

  let sha = opts.sha;
  if (!sha) {
    const shaUrl = `${repoUrl}/commits/${encodeURIComponent(defaultBranch)}`;
    const shaRes = await get(fetchImpl, shaUrl, tok, "application/vnd.github.sha");
    if (!shaRes.ok) throw new GitHubError(shaRes.status, shaUrl);
    sha = (await shaRes.text()).trim();
  }
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`not a 40-hex commit sha for ${fullName}: ${sha}`);

  const treeBody = await getJson<{ truncated: boolean; tree: Array<{ path: string; type: string }> }>(fetchImpl, `${repoUrl}/git/trees/${sha}?recursive=1`, tok);
  const tree = treeBody.tree.filter((e) => e.type === "blob").map((e) => e.path);
  const root = tree.filter((p) => !p.includes("/"));

  const readmePath = findReadme(tree);
  const readme = readmePath ? ((await getRawText(fetchImpl, rawUrl(fullName, sha, readmePath))) ?? "") : "";
  const depFiles = root.filter((p) => DEP_FILES.has(p));
  const depFileContents: Record<string, string> = {};
  for (const f of depFiles.filter((p) => ENTRY_POINT_FILES.includes(p))) {
    const text = await getRawText(fetchImpl, rawUrl(fullName, sha, f));
    if (text !== undefined) depFileContents[f] = text;
  }

  const languages = await getJson<Record<string, number>>(fetchImpl, `${repoUrl}/languages`, tok);
  const all = await getJson<Array<{ pull_request?: unknown; labels?: Array<{ name: string }> }>>(fetchImpl, `${repoUrl}/issues?state=open&per_page=100`, tok);
  const issues = all.filter((i) => !i.pull_request);

  return {
    fullName, sha, defaultBranch, readme, readmePath, topics: repo.topics ?? [], languages, depFiles, depFileContents,
    tree, treeTruncated: treeBody.truncated === true,
    openIssues: issues.length,
    goodFirstIssues: issues.filter((i) => i.labels?.some((l) => l.name.toLowerCase() === "good first issue")).length,
  };
}
