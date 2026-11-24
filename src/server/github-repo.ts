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

/** T013: the repo facts an artifact check needs. Ids are GitHub numeric ids (never logins or emails). */
export type ArtifactRepo = {
  id: number;
  fullName: string;
  private: boolean;
  ownerId: number;
  defaultBranch: string;
  /** The repo this one was forked from, and the root of its fork network; null when not a fork. */
  parentId: number | null;
  sourceId: number | null;
};
/** T013: a compare range. `authorIds` lists every commit's author id (null: no linked account); empty when tooLarge. */
export type CompareRange = { totalCommits: number; files: number; authorIds: (number | null)[]; tooLarge: boolean };
export type PullFacts = { merged: boolean; userId: number; mergeCommitSha: string | null; baseRepoId: number };
export type CommitFacts = { sha: string; authorId: number | null };

const isId = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
/** `author` of a commit or PR: its numeric id, or null when GitHub links no account. */
const authorId = (a: unknown): number | null => {
  const id = (a as { id?: unknown } | null)?.id;
  return isId(id) ? id : null;
};

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

  /** GET that answers null on 404; any other non-2xx throws. Rate limits throw RateLimitError (in `get`). */
  async function getJsonOrNull(path: string): Promise<unknown | null> {
    const res = await get(path);
    if (res.status === 404) return null;
    if (!res.ok) throw new GitHubError(res.status, path);
    return await res.json();
  }
  const repoPath = (fullName: string) => {
    if (!FULL_NAME.test(fullName)) throw new Error(`expected owner/name, got: ${fullName}`);
    return `/repos/${fullName}`;
  };
  /** A malformed answer from GitHub: treated like a failed call, never as a pass. */
  const malformed = (path: string): never => {
    throw new GitHubError(502, path);
  };

  return {
    /** T013: repo facts by owner/name, or null when GitHub answers 404 (missing, or private to this token). */
    async getRepo(fullName: string): Promise<ArtifactRepo | null> {
      const path = repoPath(fullName);
      const r = (await getJsonOrNull(path)) as Record<string, unknown> | null;
      if (!r) return null;
      const owner = r.owner as { id?: unknown } | undefined;
      if (!isId(r.id) || !isId(owner?.id) || typeof r.full_name !== "string") return malformed(path);
      const parent = r.parent as { id?: unknown } | undefined;
      const source = r.source as { id?: unknown } | undefined;
      return {
        id: r.id,
        fullName: r.full_name,
        private: r.private !== false,
        ownerId: owner.id,
        defaultBranch: typeof r.default_branch === "string" ? r.default_branch : "",
        parentId: isId(parent?.id) ? parent.id : null,
        sourceId: isId(source?.id) ? source.id : null,
      };
    },

    /** T013: the head commit SHA of a branch, or null when the branch (or repo) is not found. */
    async getBranchHead(fullName: string, branch: string): Promise<string | null> {
      const path = `${repoPath(fullName)}/branches/${branch.split("/").map(encodeURIComponent).join("/")}`;
      const b = (await getJsonOrNull(path)) as { commit?: { sha?: unknown } } | null;
      if (!b) return null;
      const sha = b.commit?.sha;
      return typeof sha === "string" && SHA.test(sha) ? sha : malformed(path);
    },

    /**
     * T013: the commits in `base...head` (both 40-hex SHAs) of one repo, 100 per page. Above `maxCommits` it stops after
     * the first page and answers tooLarge. Null when GitHub answers 404 (a SHA not in this repo's network).
     */
    async compare(fullName: string, base: string, head: string, maxCommits: number): Promise<CompareRange | null> {
      if (!SHA.test(base) || !SHA.test(head)) throw new Error("expected 40-hex SHAs");
      const authorIds: (number | null)[] = [];
      let totalCommits = 0;
      let files = 0;
      for (let page = 1; ; page++) {
        const path = `${repoPath(fullName)}/compare/${base}...${head}?per_page=100&page=${page}`;
        const c = (await getJsonOrNull(path)) as { total_commits?: unknown; commits?: unknown; files?: unknown } | null;
        if (!c) return null;
        if (!Number.isSafeInteger(c.total_commits) || !Array.isArray(c.commits)) return malformed(path);
        totalCommits = c.total_commits as number;
        if (page === 1) files = Array.isArray(c.files) ? c.files.length : 0;
        if (totalCommits > maxCommits) return { totalCommits, files, authorIds: [], tooLarge: true };
        for (const commit of c.commits as { author?: unknown }[]) authorIds.push(authorId(commit.author));
        if (authorIds.length >= totalCommits || c.commits.length === 0) break;
      }
      if (authorIds.length !== totalCommits) return malformed(`${repoPath(fullName)}/compare/${base}...${head}`);
      return { totalCommits, files, authorIds, tooLarge: false };
    },

    /**
     * T014: the changed files of `base...head` (both 40-hex SHAs) with their patches (none for a binary file). GitHub
     * lists the files on the first page only, so one commit per page is asked. Null when GitHub answers 404 (a SHA it
     * no longer has, e.g. after a force-push).
     */
    async compareFiles(
      fullName: string,
      base: string,
      head: string,
    ): Promise<{ filename: string; status: string; patch?: string }[] | null> {
      if (!SHA.test(base) || !SHA.test(head)) throw new Error("expected 40-hex SHAs");
      const path = `${repoPath(fullName)}/compare/${base}...${head}?per_page=1&page=1`;
      const c = (await getJsonOrNull(path)) as { files?: unknown } | null;
      if (!c) return null;
      if (!Array.isArray(c.files)) return malformed(path);
      return (c.files as Record<string, unknown>[]).map((f) => {
        if (typeof f.filename !== "string") return malformed(path);
        const status = typeof f.status === "string" ? f.status : "";
        return typeof f.patch === "string"
          ? { filename: f.filename, status, patch: f.patch }
          : { filename: f.filename, status };
      });
    },

    /** T013: pull request facts, or null when not found. */
    async getPull(fullName: string, number: number): Promise<PullFacts | null> {
      const path = `${repoPath(fullName)}/pulls/${number}`;
      const p = (await getJsonOrNull(path)) as Record<string, unknown> | null;
      if (!p) return null;
      const userId = authorId(p.user);
      const baseRepoId = (p.base as { repo?: { id?: unknown } } | undefined)?.repo?.id;
      if (userId === null || !isId(baseRepoId) || typeof p.merged !== "boolean") return malformed(path);
      const sha = p.merge_commit_sha;
      return {
        merged: p.merged,
        userId,
        mergeCommitSha: typeof sha === "string" && SHA.test(sha) ? sha : null,
        baseRepoId,
      };
    },

    /** T013: the 100 newest commits of a branch, newest first; [] for an empty repo (409); null when not found. */
    async listCommits(fullName: string, branch: string): Promise<CommitFacts[] | null> {
      const path = `${repoPath(fullName)}/commits?sha=${encodeURIComponent(branch)}&per_page=100`;
      const res = await get(path);
      if (res.status === 404) return null;
      if (res.status === 409) return [];
      if (!res.ok) throw new GitHubError(res.status, path);
      const list = (await res.json()) as { sha?: unknown; author?: unknown }[];
      if (!Array.isArray(list)) return malformed(path);
      return list.map((c) =>
        typeof c.sha === "string" && SHA.test(c.sha) ? { sha: c.sha, authorId: authorId(c.author) } : malformed(path),
      );
    },

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
