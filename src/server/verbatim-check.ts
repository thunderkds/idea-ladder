// T008 (8c) AC 6 (NFR-006, Grill #9): cards are original text. A text that shares a run of VERBATIM_WORDS
// consecutive words with a chunk of this repo + SHA is a verbatim copy. Words are normalised like the key check.
import { normalise, stripInlineMarkdown } from "./answer-key-check.ts";

export const VERBATIM_WORDS = 25;

export const words = (s: string): string[] =>
  normalise(stripInlineMarkdown(s))
    .split(/[^\p{L}\p{N}_]+/u)
    .filter(Boolean);

/** Every run of VERBATIM_WORDS consecutive words in each chunk text. */
export function verbatimIndex(chunkTexts: string[]): Set<string> {
  const runs = new Set<string>();
  for (const text of chunkTexts) {
    const w = words(text);
    for (let i = 0; i + VERBATIM_WORDS <= w.length; i++) runs.add(w.slice(i, i + VERBATIM_WORDS).join(" "));
  }
  return runs;
}

/** True if `text` holds a run of VERBATIM_WORDS consecutive words that is also in a chunk. */
export function copiesVerbatim(text: string, index: Set<string>): boolean {
  const w = words(text);
  for (let i = 0; i + VERBATIM_WORDS <= w.length; i++)
    if (index.has(w.slice(i, i + VERBATIM_WORDS).join(" "))) return true;
  return false;
}
