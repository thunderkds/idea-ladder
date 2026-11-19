// T008 (8c) AC 5, reworked in T031: near-duplicate removal by word overlap, within one ladder. No model call.
import { words } from "./verbatim-check.ts";

/** Jaccard similarity of the word sets of two texts, |A∩B| / |A∪B|; 0 when either set is empty. */
export function jaccard(a: string, b: string): number {
  const sa = new Set(words(a));
  const sb = new Set(words(b));
  if (sa.size === 0 || sb.size === 0) return 0;
  let shared = 0;
  for (const w of sa) if (sb.has(w)) shared++;
  return shared / (sa.size + sb.size - shared);
}

/** In order: text i is kept unless its Jaccard similarity to an EARLIER kept text is >= `threshold`. */
export function keepDistinct(texts: string[], threshold: number): boolean[] {
  const kept: string[] = [];
  return texts.map((t) => {
    if (kept.some((k) => jaccard(k, t) >= threshold)) return false;
    kept.push(t);
    return true;
  });
}
