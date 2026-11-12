// Parses what a learner (or Idea Radar's `/start?url=` link) gives us into a GitHub owner/name. No network.

export type RepoRef = { owner: string; name: string };

export class UnsupportedUrlError extends Error {
  constructor() {
    super("Only GitHub repo URLs are supported");
    this.name = "UnsupportedUrlError";
  }
}

const OWNER = /^[A-Za-z0-9-]{1,39}$/;
const NAME = /^[A-Za-z0-9._-]{1,100}$/;
const HOSTS = new Set(["github.com", "www.github.com"]);

function repoRef(owner: string | undefined, rawName: string | undefined): RepoRef {
  const name = rawName?.endsWith(".git") ? rawName.slice(0, -4) : rawName;
  // "." and ".." match NAME but would walk the API path.
  if (!owner || !name || !OWNER.test(owner) || !NAME.test(name) || name === "." || name === "..") {
    throw new UnsupportedUrlError();
  }
  return { owner, name };
}

/**
 * Accepts `https://github.com/o/n` (also `http://`, `www.`, a trailing `/`, `.git`, `/tree/<ref>/<path>`,
 * query and hash) and `o/n` pasted alone. Anything else throws UnsupportedUrlError.
 */
export function parseRepoUrl(input: string): RepoRef {
  const text = input.trim();
  const short = /^([^/:]+)\/([^/:]+)$/.exec(text);
  if (short) return repoRef(short[1], short[2]);

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new UnsupportedUrlError();
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new UnsupportedUrlError();
  if (!HOSTS.has(url.hostname) || url.port || url.username || url.password) throw new UnsupportedUrlError();

  const parts = url.pathname.split("/").slice(1);
  if (parts.at(-1) === "") parts.pop(); // one trailing slash
  const [owner, name, ...rest] = parts;
  if (rest.length && !(rest[0] === "tree" && rest.length >= 2)) throw new UnsupportedUrlError();
  return repoRef(owner, name);
}
