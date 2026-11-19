// T007: concept name rules shared by the server (mapper, PUT route) and the edit screen. No Node imports.
export const MIN_CONCEPTS = 3;
export const MAX_CONCEPTS = 6;
export const MIN_NAME = 2;
export const MAX_NAME = 60;

/** Name length in Unicode code points (an emoji counts 1, not 2). */
export const nameLength = (name: string): number => [...name].length;

// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
const CONTROL = /[\u0000-\u001f\u007f]/;

/** Why a concept name is not allowed (2-60 code points, no control characters), or null when it is. */
export function nameProblem(name: string): string | null {
  if (CONTROL.test(name)) return "name must not contain control characters";
  if (nameLength(name.trim()) < MIN_NAME) return `name must have at least ${MIN_NAME} characters`;
  if (nameLength(name) > MAX_NAME) return `name must have at most ${MAX_NAME} characters`;
  return null;
}

/** FNV-1a over the code points, as 8 hex digits: stable, no crypto import. */
function hash8(text: string): string {
  let h = 0x811c9dc5;
  for (const ch of text) {
    h = Math.imul(h ^ (ch.codePointAt(0) as number), 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Lower-case ASCII words joined by `-`. A name with no ASCII letter or digit gets `c-<hash>`, never an empty slug. */
export function conceptSlug(name: string): string {
  const folded = name
    .replace(/\+/g, "-plus-")
    .replace(/#/g, "-sharp-")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  const ascii = folded.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const hash = hash8(name.trim().toLowerCase());
  if (!ascii) return `c-${hash}`;
  // A non-ASCII letter or digit the fold could not keep: tell names apart that differ only by it.
  return /[\u0080-\u{10ffff}]/u.test(folded.replace(/[^\p{L}\p{N}]/gu, "")) ? `${ascii}-${hash}` : ascii;
}

export type ListProblem = { field: string; message: string };

/** First problem in a list of concept names (3-6, valid names, unique slugs), or null. `field` names what failed. */
export function validateConceptNames(names: string[]): ListProblem | null {
  if (names.length < MIN_CONCEPTS || names.length > MAX_CONCEPTS)
    return { field: "concepts", message: `need ${MIN_CONCEPTS} to ${MAX_CONCEPTS} concepts, got ${names.length}` };
  const seen = new Set<string>();
  for (const [i, name] of names.entries()) {
    const problem = nameProblem(name);
    if (problem) return { field: `concepts[${i}].name`, message: problem };
    const slug = conceptSlug(name);
    if (seen.has(slug)) return { field: `concepts[${i}].slug`, message: `duplicate concept "${name.trim()}"` };
    seen.add(slug);
  }
  return null;
}
