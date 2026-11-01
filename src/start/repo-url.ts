export class UnsupportedUrlError extends Error {
  constructor(public readonly input: string) {
    super('Only GitHub repository URLs (https://github.com/owner/name) are supported for now.');
    this.name = 'UnsupportedUrlError';
  }
}

export interface RepoRef {
  owner: string;
  name: string;
}

const OWNER = /^[A-Za-z0-9-]{1,39}$/;
const NAME = /^[A-Za-z0-9._-]{1,100}$/;
const HOSTS = new Set(['github.com', 'www.github.com']);

/**
 * Pure: no network call. Accepts a GitHub repo URL (optionally `.git`, trailing `/`, or `/tree/<ref>/<path>`)
 * or a bare `owner/name`. Everything else throws UnsupportedUrlError.
 */
export function parseRepoUrl(input: string): RepoRef {
  const text = input.trim();
  let segments: string[];

  if (/^[^/:?#\s]+\/[^/:?#\s]+$/.test(text)) {
    segments = text.split('/');
  } else {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      throw new UnsupportedUrlError(input);
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new UnsupportedUrlError(input);
    if (!HOSTS.has(url.hostname) || url.port !== '' || url.username !== '' || url.password !== '') {
      throw new UnsupportedUrlError(input);
    }
    segments = url.pathname.replace(/^\//, '').replace(/\/$/, '').split('/');
    const rest = segments.slice(2);
    // Allowed tails: nothing, or /tree/<ref>[/<path>...].
    if (rest.length > 0 && !(rest[0] === 'tree' && rest.length >= 2)) throw new UnsupportedUrlError(input);
    segments = segments.slice(0, 2);
  }

  const [owner, rawName] = segments;
  if (segments.length !== 2 || owner === undefined || rawName === undefined) throw new UnsupportedUrlError(input);
  const name = rawName.endsWith('.git') ? rawName.slice(0, -4) : rawName;
  if (!OWNER.test(owner) || !NAME.test(name) || name === '.' || name === '..') throw new UnsupportedUrlError(input);
  return { owner, name };
}
