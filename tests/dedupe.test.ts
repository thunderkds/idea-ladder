// T008 (8c) AC 5 / Success Criterion 4: an item at cosine >= DEDUPE_COSINE to an earlier kept item is a duplicate.
import { describe, expect, test } from "bun:test";
import { cosine, keepDistinct } from "../src/server/dedupe.ts";

/** A unit vector at cosine `c` to [1, 0, 0]. */
const at = (c: number) => [c, Math.sqrt(1 - c * c), 0];

describe("dedupe (AC 5)", () => {
  test("cosine: same direction 1, orthogonal 0, zero vector 0", () => {
    expect(cosine([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 10);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
  test("Success Criterion 4: two items at cosine 0.95 -> the second is dropped", () => {
    expect(cosine([1, 0, 0], at(0.95))).toBeCloseTo(0.95, 10);
    expect(keepDistinct([[1, 0, 0], at(0.95)], 0.92)).toEqual([true, false]);
  });
  test("the threshold is inclusive: >= 0.92 is a duplicate, 0.91 is not", () => {
    expect(keepDistinct([[1, 0, 0], at(0.92)], 0.92)).toEqual([true, false]);
    expect(keepDistinct([[1, 0, 0], at(0.91)], 0.92)).toEqual([true, true]);
  });
  test("only EARLIER KEPT items count: a dropped item does not drop the next one", () => {
    // b is a duplicate of a (0.95); c is close to b (rotated further) but only 0.81 to a: c stays.
    const a = [1, 0, 0];
    const b = at(0.95);
    const c = at(0.81);
    expect(cosine(b, c)).toBeGreaterThanOrEqual(0.92);
    expect(keepDistinct([a, b, c], 0.92)).toEqual([true, false, true]);
  });
  test("order decides which one is kept", () => {
    expect(keepDistinct([at(0.95), [1, 0, 0]], 0.92)).toEqual([true, false]);
    expect(keepDistinct([], 0.92)).toEqual([]);
  });
});
