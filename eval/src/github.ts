import { FixtureSchema, type Fixture } from "./schema.ts";

/** Pattern: experiments/core-spike/src/github.ts (copied, not imported). */

export class RateLimitError extends Error {
  constructor(public readonly resetAt: Date) {
    super(`GitHub rate limit exhausted; resets at ${resetAt.toISOString()}`);
    this.name = "RateLimitError";
  }
}

export class RepoNotFoundError extends Error {
  constructor(public readonly fullName: string) {
    super(`GitHub repo not found (deleted or renamed?): ${fullName}`);
    this.name = "RepoNotFoundError";
  }
}

export class GitHubError extends Error {
  constructor(public readonly status: number, url: string) {
    super(`GitHub API ${status} for ${url}`);
    this.name = "GitHubError";
  }
}

export interface RecordOptions {
  fetch?: typeof fetch;
  /** Sent only as the Authorization header. Never stored in a fixture. */
  token?: string;
  now?: () => Date;
}

const API = "https://api.github.com";
const NAME_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const DEP_FILES = new Set([
  "package.json", "requirements.txt", "pyproject.toml", "setup.py", "Pipfile",
  "Cargo.toml", "go.mod", "pom.xml", "build.gradle", "Gemfile", "composer.json", "deno.json",
]);
/** Dependency files larger than this are recorded as present but with empty content. */
const MAX_DEP_FILE_BYTES = 200_000;

function client(opts: RecordOptions) {
  const fetchImpl = opts.fetch ?? fetch;
  async function get(url: string, accept = "application/vnd.github+json"): Promise<Response> {
    const headers: Record<string, string> = { accept, "x-github-api-version": "2022-11-28" };
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    const res = await fetchImpl(url, { headers });
    if ((res.status === 403 || res.status === 429) && res.headers.get("x-ratelimit-remaining") === "0") {
      throw new RateLimitError(new Date(Number(res.headers.get("x-ratelimit-reset") ?? "0") * 1000));
    }
    return res;
  }
  async function getJson<T>(url: string): Promise<T> {
    const res = await get(url);
    if (!res.ok) throw new GitHubError(res.status, url);
    return (await res.json()) as T;
  }
  return { get, getJson };
}

const checkName = (fullName: string) => {
  if (!NAME_RE.test(fullName)) throw new Error(`expected owner/name, got: ${fullName}`);
};

const decode = (b64: string) => Buffer.from(b64, "base64").toString("utf8");

/** Resolves the default-branch head of a repo to a commit sha (used to pin a new golden entry). */
export async function resolveHeadSha(fullName: string, opts: RecordOptions = {}): Promise<string> {
  checkName(fullName);
  const { get } = client(opts);
  const repoUrl = `${API}/repos/${fullName}`;
  const repoRes = await get(repoUrl);
  if (repoRes.status === 404) throw new RepoNotFoundError(fullName);
  if (!repoRes.ok) throw new GitHubError(repoRes.status, repoUrl);
  const { default_branch } = (await repoRes.json()) as { default_branch: string };
  const url = `${repoUrl}/commits/${encodeURIComponent(default_branch)}`;
  const res = await get(url, "application/vnd.github.sha");
  if (!res.ok) throw new GitHubError(res.status, url);
  const sha = (await res.text()).trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`unexpected commit sha from ${url}`);
  return sha;
}

/**
 * Reads one repo at its pinned sha. All-or-nothing: any error throws, so no partial fixture is ever returned.
 * Calls: repo, commit, readme, languages, tree, issues, good-first-issues, plus one per root dependency file.
 */
export async function recordRepo(entry: { fullName: string; sha: string }, opts: RecordOptions = {}): Promise<Fixture> {
  checkName(entry.fullName);
  if (!/^[0-9a-f]{40}$/.test(entry.sha)) throw new Error(`expected a 40-hex sha, got: ${entry.sha}`);
  const { get, getJson } = client(opts);
  const repoUrl = `${API}/repos/${entry.fullName}`;
  const sha = entry.sha;

  const repoRes = await get(repoUrl);
  if (repoRes.status === 404) throw new RepoNotFoundError(entry.fullName);
  if (!repoRes.ok) throw new GitHubError(repoRes.status, repoUrl);
  const repo = (await repoRes.json()) as { default_branch: string; topics?: string[]; stargazers_count: number; language: string | null };

  const commitUrl = `${repoUrl}/commits/${sha}`;
  const commitRes = await get(commitUrl, "application/vnd.github.sha");
  if (!commitRes.ok) throw new GitHubError(commitRes.status, commitUrl);

  const readmeUrl = `${repoUrl}/readme?ref=${sha}`;
  const readmeRes = await get(readmeUrl);
  let readme = "";
  if (readmeRes.status !== 404) {
    if (!readmeRes.ok) throw new GitHubError(readmeRes.status, readmeUrl);
    readme = decode(((await readmeRes.json()) as { content: string }).content);
  }

  const languages = await getJson<Record<string, number>>(`${repoUrl}/languages`);

  const treeBody = await getJson<{ truncated: boolean; tree: Array<{ path: string; type: string }> }>(
    `${repoUrl}/git/trees/${sha}?recursive=1`,
  );
  const tree = treeBody.tree
    .filter((t): t is { path: string; type: "blob" | "tree" } => t.type === "blob" || t.type === "tree")
    .map((t) => ({ path: t.path, type: t.type }));

  const depFiles = tree.filter((t) => t.type === "blob" && !t.path.includes("/") && DEP_FILES.has(t.path)).map((t) => t.path);
  const depFileContents: Record<string, string> = {};
  for (const path of depFiles) {
    const body = await getJson<{ content?: string; size: number }>(`${repoUrl}/contents/${encodeURIComponent(path)}?ref=${sha}`);
    depFileContents[path] = body.content && body.size <= MAX_DEP_FILE_BYTES ? decode(body.content) : "";
  }

  const issues = await getJson<Array<{ pull_request?: unknown }>>(`${repoUrl}/issues?state=open&per_page=100`);
  const gfi = await getJson<Array<{ pull_request?: unknown }>>(
    `${repoUrl}/issues?state=open&per_page=100&labels=${encodeURIComponent("good first issue")}`,
  );

  return FixtureSchema.parse({
    fullName: entry.fullName,
    sha,
    recordedAt: (opts.now?.() ?? new Date()).toISOString(),
    defaultBranch: repo.default_branch,
    stars: repo.stargazers_count,
    language: repo.language ?? "",
    topics: repo.topics ?? [],
    languages,
    readme,
    tree,
    treeTruncated: treeBody.truncated === true,
    depFiles,
    depFileContents,
    openIssues: issues.filter((i) => !i.pull_request).length,
    goodFirstIssues: gfi.filter((i) => !i.pull_request).length,
  });
}
