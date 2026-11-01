export interface CoreFilesScore { recall: number; precision: number; missed: string[]; extra: string[] }
export interface ConceptsScore { overlap: number; missed: string[]; extra: string[] }

const uniq = (xs: string[]) => [...new Set(xs)];
const ratio = (n: number, d: number) => (d === 0 ? 0 : n / d);

/** Paths match exactly (case-sensitive). Duplicates in `predicted` count once. Empty sides give 0, never NaN. */
export function scoreCoreFiles(predicted: string[], expected: string[]): CoreFilesScore {
  const p = uniq(predicted);
  const e = uniq(expected);
  const eSet = new Set(e);
  const pSet = new Set(p);
  const hit = p.filter((x) => eSet.has(x)).length;
  return {
    recall: ratio(hit, e.length),
    precision: ratio(hit, p.length),
    missed: e.filter((x) => !pSet.has(x)),
    extra: p.filter((x) => !eSet.has(x)),
  };
}

/**
 * Normalised slug: lower-case, runs of non-alphanumerics become '-', and a trailing plural 's' is folded
 * (not 'ss'). DECISION (T004): 'embeddings' and 'embedding' match.
 */
export function conceptSlug(s: string): string {
  const slug = s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug.length > 3 && slug.endsWith("s") && !slug.endsWith("ss") ? slug.slice(0, -1) : slug;
}

/** `overlap` = matched expected concepts / expected concepts. */
export function scoreConcepts(predicted: string[], expected: string[]): ConceptsScore {
  const pSlugs = new Set(predicted.map(conceptSlug));
  const eSlugs = new Set(expected.map(conceptSlug));
  const missed = expected.filter((x) => !pSlugs.has(conceptSlug(x)));
  const extra = predicted.filter((x) => !eSlugs.has(conceptSlug(x)));
  return { overlap: ratio(expected.length - missed.length, expected.length), missed, extra };
}
