// T008 (8c) AC 4: the answer-key code check, ported from T001 (experiments/core-spike/src/keycheck.ts).
// The check is lexical. Known T001 limits that still PASS here: a key inside a negated sentence ("there is no
// retry") and a distractor that also occurs in the chunk. T009's blind solver (model B) is the second check for them.

export type KeyCheckInput = { options: string[]; key: string; chunk: string };
export type KeyCheckResult = { pass: boolean; reason: "ok" | "key-not-in-options" | "key-not-in-chunk" };

/** NFKC, lower case, collapsed spaces (T001 keycheck's rule). */
export const normalise = (s: string): string => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

/** Drops inline markdown marks: backticks, and `*` / `_` runs at a word edge (`_last_`, `**x**`); `snake_case` stays. */
export const stripInlineMarkdown = (s: string): string =>
  s
    .replace(/`+/g, "")
    .replace(/(?<![\p{L}\p{N}])[*_]+(?=[\p{L}\p{N}])/gu, "")
    .replace(/(?<=[\p{L}\p{N}])[*_]+(?![\p{L}\p{N}])/gu, "");

const WORD = /[\p{L}\p{N}_]/u;
const DIGIT = /\p{N}/u;

/** True if the occurrence at [i, j) in `hay` is not glued to a longer word or number. */
function atBoundaries(hay: string, i: number, j: number): boolean {
  const first = hay[i] as string;
  const last = hay[j - 1] as string;
  if (WORD.test(first)) {
    const prev = hay[i - 1];
    if (prev !== undefined && WORD.test(prev)) return false; // bitmap
    const prev2 = hay[i - 2];
    if (
      prev !== undefined &&
      (prev === "," || prev === ".") &&
      prev2 !== undefined &&
      DIGIT.test(prev2) &&
      DIGIT.test(first)
    )
      return false; // 60,000 / 3.5
  }
  if (WORD.test(last)) {
    const next = hay[j];
    if (next !== undefined && WORD.test(next)) return false; // mapping
    const next2 = hay[j + 1];
    if (
      next !== undefined &&
      (next === "," || next === ".") &&
      next2 !== undefined &&
      DIGIT.test(next2) &&
      DIGIT.test(last)
    )
      return false; // 60,000
  }
  return true;
}

/** Code-only check: the key is one of the options and occurs in the chunk at token boundaries (markdown stripped). */
export function checkAnswerKey({ options, key, chunk }: KeyCheckInput): KeyCheckResult {
  if (!options.includes(key)) return { pass: false, reason: "key-not-in-options" };
  const k = normalise(stripInlineMarkdown(key));
  if (k === "") return { pass: false, reason: "key-not-in-chunk" };
  const hay = normalise(stripInlineMarkdown(chunk));
  for (let from = hay.indexOf(k); from !== -1; from = hay.indexOf(k, from + 1)) {
    if (atBoundaries(hay, from, from + k.length)) return { pass: true, reason: "ok" };
  }
  return { pass: false, reason: "key-not-in-chunk" };
}
