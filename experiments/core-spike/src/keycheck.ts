export interface KeyCheckInput { options: string[]; key: string; chunk: string }
export interface KeyCheckResult { pass: boolean; reason: "ok" | "key-not-in-options" | "key-not-in-chunk" }

export const normalise = (s: string): string => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

const WORD = /[\p{L}\p{N}_]/u;
const DIGIT = /\p{N}/u;

/** True if the occurrence at [i, j) in `hay` is not glued to a longer word or number. */
function atBoundaries(hay: string, i: number, j: number): boolean {
  const first = hay[i]!;
  const last = hay[j - 1]!;
  if (WORD.test(first)) {
    const prev = hay[i - 1];
    if (prev !== undefined && WORD.test(prev)) return false; // bitmap
    const prev2 = hay[i - 2];
    if (prev !== undefined && (prev === "," || prev === ".") && prev2 !== undefined && DIGIT.test(prev2) && DIGIT.test(first)) return false; // 60,000 / 3.5
  }
  if (WORD.test(last)) {
    const next = hay[j];
    if (next !== undefined && WORD.test(next)) return false; // mapping
    const next2 = hay[j + 1];
    if (next !== undefined && (next === "," || next === ".") && next2 !== undefined && DIGIT.test(next2) && DIGIT.test(last)) return false; // 60,000
  }
  return true;
}

/** Code-only check: the key is one of the options and occurs in the chunk at token boundaries. */
export function checkAnswerKey({ options, key, chunk }: KeyCheckInput): KeyCheckResult {
  if (!options.includes(key)) return { pass: false, reason: "key-not-in-options" };
  const k = normalise(key);
  if (k === "") return { pass: false, reason: "key-not-in-chunk" };
  const hay = normalise(chunk);
  for (let from = hay.indexOf(k); from !== -1; from = hay.indexOf(k, from + 1)) {
    if (atBoundaries(hay, from, from + k.length)) return { pass: true, reason: "ok" };
  }
  return { pass: false, reason: "key-not-in-chunk" };
}
