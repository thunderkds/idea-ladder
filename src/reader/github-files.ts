// The repo reader's view of GitHub: the blob tree at the pinned SHA, and file bytes through the contents API,
// cached per repo + SHA + path in Postgres so a retried step re-reads nothing it already has.
import type pg from 'pg';
import { GitHubError, get, type GithubOptions } from '../start/github.js';
import { decodeFile, type RepoFile } from './repo-tools.js';

export interface RepoTree {
  tree: string[];
  sizes: Map<string, number>;
  /** GitHub reported the tree as cut short (more than 100,000 entries). The reader sees the part GitHub sent. */
  truncated: boolean;
}

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

const FULL_NAME = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const SHA = /^[0-9a-f]{40}$/;
function assertPinned(repo: string, sha: string): void {
  if (!FULL_NAME.test(repo) || repo.split('/').some((p) => p === '.' || p === '..') || !SHA.test(sha)) {
    throw new Error(`expected owner/name and a 40-hex sha, got: ${repo} ${sha}`);
  }
}

/** One API call: every blob at `sha`, with sizes. */
export async function fetchRepoTree(github: GithubOptions, repo: string, sha: string): Promise<RepoTree> {
  assertPinned(repo, sha);
  const path = `/repos/${repo}/git/trees/${sha}?recursive=1`;
  const res = await get(github, path);
  if (!res.ok) throw new GitHubError(res.status, path);
  const body = (await res.json()) as { truncated?: boolean; tree?: Array<{ path: string; type: string; size?: number }> };
  const blobs = (body.tree ?? []).filter((e) => e.type === 'blob');
  return {
    tree: blobs.map((e) => e.path),
    sizes: new Map(blobs.map((e) => [e.path, e.size ?? 0])),
    truncated: body.truncated === true,
  };
}

async function fetchFile(github: GithubOptions, repo: string, sha: string, filePath: string): Promise<RepoFile> {
  const path = `/repos/${repo}/contents/${encodePath(filePath)}?ref=${sha}`;
  const res = await get(github, path);
  if (!res.ok) throw new GitHubError(res.status, path);
  const body = (await res.json()) as { type?: string; encoding?: string; content?: string };
  if (Array.isArray(body) || (body.type !== undefined && body.type !== 'file')) throw new GitHubError(422, path);
  // Files over 1 MB come back without content.
  if (body.encoding !== 'base64' || typeof body.content !== 'string') return { kind: 'too-large' };
  return decodeFile(Buffer.from(body.content, 'base64'));
}

/** Reads one file at the pinned SHA: Postgres cache first, then GitHub, then the cache is filled. */
export function cachedFileReader(pool: pg.Pool, github: GithubOptions, repo: string, sha: string): (path: string) => Promise<RepoFile> {
  assertPinned(repo, sha);
  const key = repo.toLowerCase();
  return async (path) => {
    const hit = await pool.query<{ kind: RepoFile['kind']; content: string | null }>(
      'SELECT kind, content FROM repo_file_cache WHERE repo_full_name = $1 AND commit_sha = $2 AND path = $3',
      [key, sha, path],
    );
    const row = hit.rows[0];
    if (row) return row.kind === 'text' ? { kind: 'text', text: row.content ?? '' } : { kind: row.kind };
    const file = await fetchFile(github, repo, sha, path);
    await pool.query(
      `INSERT INTO repo_file_cache (repo_full_name, commit_sha, path, kind, content) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (repo_full_name, commit_sha, path) DO NOTHING`,
      [key, sha, path, file.kind, file.kind === 'text' ? file.text : null],
    );
    return file;
  };
}
