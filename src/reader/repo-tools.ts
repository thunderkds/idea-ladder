// The three read-only tools of the repo reader: list, read, search. Every path is checked against the tree at
// the pinned SHA, so a tool can never name a file outside the repo. Repo text is data; nothing here executes it.

export type RepoFile = { kind: 'text'; text: string } | { kind: 'binary' } | { kind: 'too-large' };

/** The reader's only view of a repo. `read` returns the file at the pinned SHA; it throws only on infrastructure errors. */
export interface RepoFiles {
  /** Blob paths at the pinned SHA. */
  tree: readonly string[];
  /** Blob sizes in bytes, when the tree source reports them. */
  sizes?: ReadonlyMap<string, number>;
  read(path: string): Promise<RepoFile>;
}

export const MAX_READ_LINES = 400;
export const MAX_READ_BYTES = 32 * 1024;
export const MAX_LINE_CHARS = 10_000;
export const MAX_LIST_ENTRIES = 200;
export const MAX_SEARCH_MATCHES = 50;
export const MAX_SEARCH_FILE_BYTES = 100 * 1024;
/** New (not yet read) files one search call may fetch. */
export const MAX_SEARCH_FETCHES = 30;
export const MAX_FILE_BYTES = 1024 * 1024;
const MATCH_TEXT_CHARS = 200;

const NOT_SEARCHED = /\.(png|jpe?g|gif|svg|ico|webp|pdf|zip|gz|tgz|woff2?|ttf|otf|eot|mp[34]|wasm|lock|min\.js|map)$/i;

/** Text in, text out. A NUL byte anywhere means binary (Postgres text cannot hold it); so does a Git LFS pointer. */
export function decodeFile(bytes: Uint8Array): RepoFile {
  if (bytes.length > MAX_FILE_BYTES) return { kind: 'too-large' };
  if (bytes.includes(0)) return { kind: 'binary' };
  const text = new TextDecoder('utf-8').decode(bytes);
  if (text.startsWith('version https://git-lfs.github.com/spec')) return { kind: 'binary' };
  return { kind: 'text', text };
}

/**
 * Repo-relative path with forward slashes, or `null` when the model's path is not acceptable:
 * absolute, backslashes, NUL, or any `..` segment. `""` and `.` mean the root.
 */
export function normalizePath(raw: string): string | null {
  if (raw.includes('\0') || raw.includes('\\') || raw.startsWith('/')) return null;
  const parts = raw.split('/').filter((p) => p !== '' && p !== '.');
  if (parts.includes('..')) return null;
  return parts.join('/');
}

export type ListResult = { path: string; entries: string[]; truncated?: true } | { error: string };
export type ReadResult =
  | { path: string; startLine: number; endLine: number; totalLines: number; content: string; truncated?: true; nextStartLine?: number }
  | { error: string };
export type SearchResult = { matches: Array<{ path: string; line?: number; text?: string }>; truncated?: true } | { error: string };

export interface ReaderTools {
  list(path: string): ListResult;
  read(path: string, startLine?: number, endLine?: number): Promise<ReadResult>;
  search(query: string): Promise<SearchResult>;
  /** First infrastructure error seen by a tool, if any. The loop stops and the step rethrows it. */
  fatal(): unknown;
}

export function createReaderTools(files: RepoFiles): ReaderTools {
  const treeSet = new Set(files.tree);
  const dirs = new Set<string>(['']);
  for (const p of files.tree) {
    for (let i = p.indexOf('/'); i !== -1; i = p.indexOf('/', i + 1)) dirs.add(p.slice(0, i));
  }
  const cache = new Map<string, RepoFile>();
  let fatalError: unknown;

  async function load(path: string): Promise<RepoFile | undefined> {
    const hit = cache.get(path);
    if (hit) return hit;
    try {
      const file = await files.read(path);
      cache.set(path, file);
      return file;
    } catch (err) {
      fatalError ??= err;
      return undefined;
    }
  }

  function list(raw: string): ListResult {
    const path = normalizePath(raw);
    if (path === null) return { error: 'path-not-allowed' };
    if (!dirs.has(path)) return { error: 'not-a-directory' };
    const prefix = path === '' ? '' : `${path}/`;
    const names = new Set<string>();
    for (const p of files.tree) {
      if (!p.startsWith(prefix)) continue;
      const rest = p.slice(prefix.length);
      const slash = rest.indexOf('/');
      names.add(slash === -1 ? rest : `${rest.slice(0, slash)}/`);
    }
    const sorted = [...names].sort();
    return sorted.length > MAX_LIST_ENTRIES
      ? { path, entries: sorted.slice(0, MAX_LIST_ENTRIES), truncated: true }
      : { path, entries: sorted };
  }

  async function read(raw: string, startLine = 1, endLine?: number): Promise<ReadResult> {
    const path = normalizePath(raw);
    if (path === null) return { error: 'path-not-allowed' };
    if (!treeSet.has(path)) return { error: 'path-not-in-tree' };
    if (!Number.isInteger(startLine) || startLine < 1 || (endLine !== undefined && (!Number.isInteger(endLine) || endLine < startLine))) {
      return { error: 'invalid-range' };
    }
    const file = await load(path);
    if (!file) return { error: 'read-failed' };
    if (file.kind === 'binary') return { error: 'binary-file' };
    if (file.kind === 'too-large') return { error: 'file-too-large' };
    const lines = file.text.split('\n');
    if (lines.at(-1) === '') lines.pop();
    if (lines.some((l) => l.length > MAX_LINE_CHARS)) return { error: 'minified-file' };
    const totalLines = lines.length;
    if (totalLines > 0 && startLine > totalLines) return { error: 'invalid-range' };
    const lastWanted = Math.min(endLine ?? totalLines, totalLines, startLine + MAX_READ_LINES - 1);
    const out: string[] = [];
    let bytes = 0;
    let last = startLine - 1;
    for (let n = startLine; n <= lastWanted; n++) {
      const line = lines[n - 1] ?? '';
      bytes += Buffer.byteLength(line, 'utf8') + 1;
      if (bytes > MAX_READ_BYTES && out.length > 0) break;
      out.push(line);
      last = n;
    }
    const result: ReadResult = { path, startLine, endLine: last, totalLines, content: out.join('\n') };
    if (last < Math.min(endLine ?? totalLines, totalLines)) {
      result.truncated = true;
      result.nextStartLine = last + 1;
    }
    return result;
  }

  async function search(query: string): Promise<SearchResult> {
    const q = query.toLowerCase();
    if (q.length < 2 || q.length > 100) return { error: 'invalid-query' };
    const matches: Array<{ path: string; line?: number; text?: string }> = [];
    let truncated = false;
    const add = (m: { path: string; line?: number; text?: string }): boolean => {
      if (matches.length >= MAX_SEARCH_MATCHES) {
        truncated = true;
        return false;
      }
      matches.push(m);
      return true;
    };
    for (const p of files.tree) if (p.toLowerCase().includes(q) && !add({ path: p })) break;

    const searchable = (p: string) => !NOT_SEARCHED.test(p) && (files.sizes?.get(p) ?? 0) <= MAX_SEARCH_FILE_BYTES;
    const seen = files.tree.filter((p) => cache.has(p) && searchable(p));
    const unseen = files.tree.filter((p) => !cache.has(p) && searchable(p)).slice(0, MAX_SEARCH_FETCHES);
    for (let i = 0; i < unseen.length; i += 10) await Promise.all(unseen.slice(i, i + 10).map((p) => load(p)));
    if (fatalError !== undefined) return { error: 'read-failed' };

    scan: for (const p of [...seen, ...unseen]) {
      const f = cache.get(p);
      if (f?.kind !== 'text') continue;
      const lines = f.text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        if (line.toLowerCase().includes(q) && !add({ path: p, line: i + 1, text: line.trim().slice(0, MATCH_TEXT_CHARS) })) break scan;
      }
    }
    return truncated ? { matches, truncated: true } : { matches };
  }

  return { list, read, search, fatal: () => fatalError };
}
