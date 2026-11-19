// T008 (8c) AC 6 / Success Criterion 5: a run of >= 25 consecutive words shared with a chunk is a verbatim copy.
import { describe, expect, test } from "bun:test";
import { copiesVerbatim, VERBATIM_WORDS, verbatimIndex } from "../src/server/verbatim-check.ts";

const N = (n: number, from = 0) => Array.from({ length: n }, (_, i) => `w${i + from}`).join(" ");
const CHUNK = `Intro text. ${N(40)} and the end.`;

describe("verbatim check (AC 6)", () => {
  test("Success Criterion 5: a text that copies 30 words of a chunk is a copy", () => {
    expect(copiesVerbatim(`My card says: ${N(30, 5)}.`, verbatimIndex([CHUNK]))).toBe(true);
  });
  test(`exactly ${VERBATIM_WORDS} shared words is a copy; ${VERBATIM_WORDS - 1} is not`, () => {
    const index = verbatimIndex([CHUNK]);
    expect(copiesVerbatim(N(VERBATIM_WORDS, 3), index)).toBe(true);
    expect(copiesVerbatim(`${N(VERBATIM_WORDS - 1, 3)} different`, index)).toBe(false);
  });
  test("words are normalised like the key check: case, spaces, punctuation and inline markdown do not hide a copy", () => {
    const copy = N(30)
      .split(" ")
      .map((w, i) => (i % 3 === 0 ? w.toUpperCase() : i % 3 === 1 ? `**${w}**,` : `\`${w}\`\n`))
      .join(" ");
    expect(copiesVerbatim(copy, verbatimIndex([CHUNK]))).toBe(true);
  });
  test("a run split across two chunks is not one copy; any chunk of the repo counts", () => {
    const index = verbatimIndex([N(15), N(15, 15), "x y"]);
    expect(copiesVerbatim(N(30), index)).toBe(false);
    expect(copiesVerbatim(N(30), verbatimIndex(["other chunk", CHUNK]))).toBe(true);
  });
  test("short texts and an empty index never match", () => {
    expect(copiesVerbatim("What does on() do?", verbatimIndex([CHUNK]))).toBe(false);
    expect(copiesVerbatim(N(30), verbatimIndex([]))).toBe(false);
  });
});
