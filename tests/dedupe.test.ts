// T031 AC 3: an item at word-overlap (Jaccard) >= DEDUPE_JACCARD to an earlier kept item is a duplicate.
import { describe, expect, test } from "bun:test";
import { jaccard, keepDistinct } from "../src/server/dedupe.ts";

describe("dedupe (word overlap)", () => {
  test("jaccard: identical 1, disjoint 0, partial |A∩B| / |A∪B|", () => {
    expect(jaccard("what stores the handlers", "what stores the handlers")).toBe(1);
    expect(jaccard("alpha beta", "gamma delta")).toBe(0);
    expect(jaccard("a b c d", "a b c e")).toBeCloseTo(3 / 5, 10);
  });
  test("empty word sets score 0 (no divide by zero); an empty or punctuation-only text is never a duplicate", () => {
    expect(jaccard("", "")).toBe(0);
    expect(jaccard("?!", "a b")).toBe(0);
    expect(keepDistinct(["", "", "?!"], 0.8)).toEqual([true, true, true]);
  });
  test("case, punctuation and inline markdown do not matter", () => {
    expect(jaccard("What stores the `handlers`?", "what STORES the handlers")).toBe(1);
    expect(keepDistinct(["What stores the handlers?", "what stores the handlers!"], 0.8)).toEqual([true, false]);
  });
  test("two questions that differ by one word of eleven: the second is dropped (10/12 >= 0.8)", () => {
    const a = "which structure does the emitter use to store every registered handler function";
    const b = "which structure does the emitter use to store every registered listener function";
    expect(jaccard(a, b)).toBeCloseTo(10 / 12, 10);
    expect(keepDistinct([a, b], 0.8)).toEqual([true, false]);
  });
  test("two questions on different facts of one chunk are both kept", () => {
    expect(
      keepDistinct(["What stores the handlers in mitt?", "Which method removes a listener from the emitter?"], 0.8),
    ).toEqual([true, true]);
  });
  test("the threshold is inclusive", () => {
    expect(keepDistinct(["a b c d", "a b c e"], 0.6)).toEqual([true, false]);
    expect(keepDistinct(["a b c d", "a b c e"], 0.61)).toEqual([true, true]);
  });
  test("only EARLIER KEPT items count: a dropped item does not drop the next one", () => {
    const a = "a b c d e f g h i j";
    const b = "a b c d e f g h i k"; // 9/11 to a: dropped
    const c = "a b c d e f g h x k"; // 8/12 to a (kept a only), 9/11 to b
    expect(jaccard(b, c)).toBeGreaterThanOrEqual(0.8);
    expect(jaccard(a, c)).toBeLessThan(0.8);
    expect(keepDistinct([a, b, c], 0.8)).toEqual([true, false, true]);
  });
  test("order decides which one is kept", () => {
    expect(keepDistinct(["a b c d e f g h i k", "a b c d e f g h i j"], 0.8)).toEqual([true, false]);
    expect(keepDistinct([], 0.8)).toEqual([]);
  });
});
