// Reads public repos from the GitHub REST API with the app token.
// Pattern: experiments/core-spike/src/github.ts (copied, not imported), plus the token, one redirect hop, the tree.
import type { RepoRef } from "./repo-url.ts";

export type RepoHead = { fullName: string; sha: string };

export type RepoSnapshot = {
  fullName: string;
  sha: string;
  defaultBranch: string;
  archived: boolean;
  readme: string;
  topics: string[];
  languages: Record<string, number>;
  /** Root-level dependency files, from the tree. */
  depFiles: string[];
  /** Open issues, pull requests excluded. First page only (max 100). */
  openIssues: number;
  /** Open issues labelled "good first issue" (first page, max 100). */
  goodFirstIssues: number;
  tree: { path: string; type: "blob" | "tree" }[];
  treeTruncated: boolean;
};

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

export class RepoEmptyError extends Error {
  constructor(public readonly fullName: string) {
    super(`GitHub repo has no commits: ${fullName}`);
    this.name = "RepoEmptyError";
  }
}

/** `status` 0 means no response (network error or timeout). */
export class GitHubError extends Error {
  get transient(): boolean {
    return this.status === 0 || this.status >= 500;
  }
  constructor(
    public readonly status: number,
    path: string,
  ) {
    super(`GitHub API ${status} for ${path}`);
    this.name = "GitHubError";
  }
}

const SHA = /^[0-9a-f]{40}$/;
/** readFile reads at most this many bytes of a file; the rest is never downloaded. */
export const MAX_FILE_BYTES = 1024 * 1024;
const FULL_NAME_SHAPE = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
/** owner/name; "." and ".." match the shape but would walk the API path. */
const FULL_NAME = {
  test: (value: string) => FULL_NAME_SHAPE.test(value) && !value.split("/").some((p) => p === "." || p === ".."),
};
const DEP_FILES = new Set([
  "package.json",
  "requirements.txt",
  "pyproject.toml",
  "setup.py",
  "Pipfile",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "Gemfile",
  "composer.json",
  "deno.json",
]);

export type GithubRepoClient = ReturnType<typeof githubRepoClient>;

export function githubRepoClient(opts: { baseUrl: string; token: string; fetch?: typeof fetch }) {
  const fetchImpl = opts.fetch ?? fetch;
  const origin = new URL(opts.baseUrl).origin;

  /** One GitHub call. Checks the rate limit on every response; follows at most one same-origin redirect. */
  async function get(path: string, accept = "application/vnd.github+json"): Promise<Response> {
    let url = new URL(path, origin);
    for (let hop = 0; ; hop++) {
      const res = await fetchImpl(url, {
        headers: {
          accept,
          // Empty only for the fixture recorder (unauthenticated, 60 req/h); config requires a token.
          ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
          "user-agent": "idea-ladder",
          "x-github-api-version": "2022-11-28",
        },
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      }).catch(() => {
        throw new GitHubError(0, path); // network error or timeout: transient
      });
      if ((res.status === 403 || res.status === 429) && res.headers.get("x-ratelimit-remaining") === "0") {
        const resetS = Number(res.headers.get("x-ratelimit-reset"));
        const resetMs = Number.isFinite(resetS) && resetS > 0 ? resetS * 1000 : Date.now() + 60_000;
        throw new RateLimitError(new Date(resetMs));
      }
      const location = res.headers.get("location");
      if (![301, 302, 307, 308].includes(res.status) || !location) return res;
      const next = new URL(location, url);
      // Renamed/transferred repos redirect once; never send the token to another host.
      if (hop >= 1 || next.origin !== origin) throw new GitHubError(res.status, path);
      url = next;
    }
  }

  async function getJson<T>(path: string): Promise<T> {
    const res = await get(path);
    if (!res.ok) throw new GitHubError(res.status, path);
    return (await res.json()) as T;
  }

  return {
    /** The default-branch HEAD commit and the canonical (lower-case) repo name, in one call. */
    async resolveHead(ref: RepoRef): Promise<RepoHead> {
      const requested = `${ref.owner}/${ref.name}`;
      const path = `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/commits?per_page=1`;
      const res = await get(path);
      if (res.status === 404) throw new RepoNotFoundError(requested);
      if (res.status === 409) throw new RepoEmptyError(requested); // "Git Repository is empty."
      if (!res.ok) throw new GitHubError(res.status, path);
      const [commit] = (await res.json()) as { sha?: unknown; html_url?: unknown }[];
      if (!commit) throw new RepoEmptyError(requested);
      if (typeof commit.sha !== "string" || !SHA.test(commit.sha)) throw new GitHubError(res.status, path);
      // html_url = https://github.com/<owner>/<name>/commit/<sha>: the canonical name after a rename.
      const [owner, name] =
        typeof commit.html_url === "string" ? new URL(commit.html_url).pathname.split("/").slice(1) : [];
      const canonical = owner && name && FULL_NAME.test(`${owner}/${name}`) ? `${owner}/${name}` : requested;
      return { fullName: canonical.toLowerCase(), sha: commit.sha };
    },

    /**
     * T006: one file's text at a pinned SHA (contents API, raw media type), or null for a binary file
     * (a NUL byte anywhere in the bytes read). Only the first 1 MB is downloaded and kept: the reader shows at
     * most 400 lines per call.
     */
    async readFile(fullName: string, sha: string, path: string): Promise<string | null> {
      if (!FULL_NAME.test(fullName)) throw new Error(`expected owner/name, got: ${fullName}`);
      if (!SHA.test(sha)) throw new Error(`expected a 40-hex sha, got: ${sha}`);
      const segments = path.split("/");
      if (segments.some((p) => p === "" || p === "." || p === ".."))
        throw new Error(`expected a repo path, got: ${path}`);
      const apiPath = `/repos/${fullName}/contents/${segments.map(encodeURIComponent).join("/")}?ref=${sha}`;
      const res = await get(apiPath, "application/vnd.github.raw+json");
      if (!res.ok) throw new GitHubError(res.status, apiPath);
      const chunks: Uint8Array[] = [];
      let size = 0;
      const body = res.body?.getReader();
      try {
        while (body && size < MAX_FILE_BYTES) {
          const { done, value } = await body.read();
          if (done) break;
          chunks.push(value);
          size += value.length;
        }
      } catch {
        throw new GitHubError(0, apiPath); // the connection broke mid-body: transient
      } finally {
        await body?.cancel().catch(() => {});
      }
      const bytes = Buffer.concat(chunks).subarray(0, MAX_FILE_BYTES);
      if (bytes.includes(0)) return null;
      return new TextDecoder().decode(bytes);
    },

    /** Reads one repo at a pinned SHA. All-or-nothing: any error throws, no partial snapshot. 6 calls. */
    async fetchSnapshot(fullName: string, sha: string): Promise<RepoSnapshot> {
      if (!FULL_NAME.test(fullName)) throw new Error(`expected owner/name, got: ${fullName}`);
      if (!SHA.test(sha)) throw new Error(`expected a 40-hex sha, got: ${sha}`);
      const repoPath = `/repos/${fullName}`;

      const repoRes = await get(repoPath);
      if (repoRes.status === 404) throw new RepoNotFoundError(fullName);
      if (!repoRes.ok) throw new GitHubError(repoRes.status, repoPath);
      const repo = (await repoRes.json()) as { default_branch: string; topics?: string[]; archived?: boolean };

      const readmePath = `${repoPath}/readme?ref=${sha}`;
      const readmeRes = await get(readmePath);
      let readme = "";
      if (readmeRes.status !== 404) {
        if (!readmeRes.ok) throw new GitHubError(readmeRes.status, readmePath);
        readme = Buffer.from(((await readmeRes.json()) as { content: string }).content, "base64").toString("utf8");
      }

      const languages = await getJson<Record<string, number>>(`${repoPath}/languages`);
      const treeBody = await getJson<{ truncated?: boolean; tree: { path: string; type: string }[] }>(
        `${repoPath}/git/trees/${sha}?recursive=1`,
      );
      const tree = treeBody.tree
        .filter((t): t is { path: string; type: "blob" | "tree" } => t.type === "blob" || t.type === "tree")
        .map((t) => ({ path: t.path, type: t.type }));
      const depFiles = tree.filter((t) => t.type === "blob" && DEP_FILES.has(t.path)).map((t) => t.path);

      const issues = await getJson<{ pull_request?: unknown }[]>(`${repoPath}/issues?state=open&per_page=100`);
      const gfi = await getJson<{ pull_request?: unknown }[]>(
        `${repoPath}/issues?state=open&per_page=100&labels=${encodeURIComponent("good first issue")}`,
      );

      return {
        fullName,
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
        treeTruncated: treeBody.truncated === true,
      };
    },
  };
}
