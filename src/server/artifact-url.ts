// T013: parses the artifact links a learner submits. Only `https://github.com/...`, exact host; no network.
// The stored URL is rebuilt from the parsed parts, so the same artifact always has the same URL.
import { repoRef, UnsupportedUrlError } from "./repo-url.ts";

export const MAX_ARTIFACT_URL_LENGTH = 2048;

export type BranchRef = { owner: string; name: string; branch: string; url: string };
export type L4Ref =
  | { kind: "repo"; owner: string; name: string; url: string }
  | { kind: "pr"; owner: string; name: string; number: number; url: string };

// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
const BAD_REF_CHARS = /[\x00-\x20\x7f~^:?*[\\]/;

/** A branch name git accepts (git check-ref-format, the parts that matter for a URL path). */
function isBranchName(b: string): boolean {
  return (
    b.length > 0 &&
    b.length <= 255 &&
    !BAD_REF_CHARS.test(b) &&
    !b.includes("..") &&
    !b.includes("//") &&
    !b.includes("@{") &&
    !b.startsWith("/") &&
    !b.startsWith("-") &&
    !b.endsWith("/") &&
    !b.endsWith(".") &&
    !b.endsWith(".lock") &&
    b !== "@"
  );
}

/** The path segments of an `https://github.com/` URL (one trailing slash dropped), or undefined. */
function githubPath(input: unknown): string[] | undefined {
  if (typeof input !== "string" || input.length > MAX_ARTIFACT_URL_LENGTH) return undefined;
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port || url.username || url.password)
    return undefined;
  const parts = url.pathname.split("/").slice(1);
  if (parts.at(-1) === "") parts.pop();
  try {
    return parts.map(decodeURIComponent);
  } catch {
    return undefined; // malformed escapes
  }
}

function ref(owner: string | undefined, name: string | undefined) {
  try {
    return repoRef(owner, name);
  } catch (err) {
    if (err instanceof UnsupportedUrlError) return undefined;
    throw err;
  }
}

/** `https://github.com/<owner>/<repo>/tree/<branch>`; the branch may contain `/`. */
export function parseBranchUrl(input: unknown): BranchRef | undefined {
  const parts = githubPath(input);
  if (!parts || parts.length < 4 || parts[2] !== "tree") return undefined;
  const r = ref(parts[0], parts[1]);
  const branch = parts.slice(3).join("/");
  if (!r || !isBranchName(branch)) return undefined;
  const url = `https://github.com/${r.owner}/${r.name}/tree/${parts.slice(3).map(encodeURIComponent).join("/")}`;
  return { ...r, branch, url };
}

/** `https://github.com/<owner>/<repo>` or `https://github.com/<owner>/<repo>/pull/<number>`. */
export function parseL4Url(input: unknown): L4Ref | undefined {
  const parts = githubPath(input);
  if (!parts) return undefined;
  const r = ref(parts[0], parts[1]);
  if (!r) return undefined;
  if (parts.length === 2) return { kind: "repo", ...r, url: `https://github.com/${r.owner}/${r.name}` };
  if (parts.length === 4 && parts[2] === "pull" && /^[1-9][0-9]{0,8}$/.test(parts[3] as string)) {
    const number = Number(parts[3]);
    return { kind: "pr", ...r, number, url: `https://github.com/${r.owner}/${r.name}/pull/${number}` };
  }
  return undefined;
}
