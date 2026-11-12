export interface CoreFilesScore {
  recall: number;
  precision: number;
  missed: string[];
  extra: string[];
}

export interface ConceptsScore {
  overlap: number;
  missed: string[];
  extra: string[];
}

const ratio = (num: number, den: number) => (den === 0 ? 0 : num / den);
const unique = <T>(xs: T[]) => [...new Set(xs)];

/**
 * Exact, case-sensitive path match (`README.md` is not `readme.md`).
 * recall = hits / expected, precision = hits / predicted; both 0 (never NaN) on an empty side.
 * Duplicate predictions count once.
 */
export function scoreCoreFiles(predicted: string[], expected: string[]): CoreFilesScore {
  const p = unique(predicted);
  const e = unique(expected);
  const expectedSet = new Set(e);
  const predictedSet = new Set(p);
  const hits = p.filter((x) => expectedSet.has(x)).length;
  return {
    recall: ratio(hits, e.length),
    precision: ratio(hits, p.length),
    missed: e.filter((x) => !predictedSet.has(x)),
    extra: p.filter((x) => !expectedSet.has(x)),
  };
}

/**
 * Normalised slug: lower case, split on non-alphanumerics, plural 's' dropped from tokens longer than
 * 3 characters that do not end in 'ss', joined with '-'. Decision (tested): `embeddings` = `embedding`,
 * `Rust async` = `rust-async`, `class` stays `class`.
 */
export function conceptSlug(text: string): string {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((t) => (t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t))
    .join("-");
}

/**
 * overlap = Jaccard on slugs: |predicted ∩ expected| / |predicted ∪ expected|. Extras lower the score,
 * so listing many concepts cannot game it. missed / extra keep the original text.
 */
export function scoreConcepts(predicted: string[], expected: string[]): ConceptsScore {
  const ps = new Set(predicted.map(conceptSlug));
  const es = new Set(expected.map(conceptSlug));
  const inter = [...ps].filter((s) => es.has(s)).length;
  const union = new Set([...ps, ...es]).size;
  return {
    overlap: ratio(inter, union),
    missed: expected.filter((c) => !ps.has(conceptSlug(c))),
    extra: predicted.filter((c) => !es.has(conceptSlug(c))),
  };
}
