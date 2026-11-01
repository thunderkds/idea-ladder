import { describe, expect, it } from "vitest";
import { measure, type Mcq } from "../src/measure.js";

const mk = (id: string, key: string, options: string[], chunk: string, kind: Mcq["kind"] = "span"): Mcq => ({
  id, kind, question: "q", options, key, chunk, source: { repo: "o/r", path: "README.md", sha: "a".repeat(40) },
});

describe("measure", () => {
  // Hand-checked outcomes (3 derived wrong keys each):
  //  m1 key a in chunk; wrong b (absent -> caught), c (absent -> caught), d (present -> MISS)
  //  m2 key a in chunk; wrong b,c,d absent -> all caught
  //  m3 key "x1" NOT in chunk (paraphrase) -> false reject; wrong p,q,r absent -> caught, but r present -> MISS
  //  m4 key a in chunk as bitmap only -> false reject; wrong b,c,d absent -> caught
  const items = [
    mk("m1", "alpha", ["alpha", "beta", "gamma", "delta"], "alpha and delta are here"),
    mk("m2", "alpha", ["alpha", "beta", "gamma", "delta"], "alpha only"),
    mk("m3", "x1", ["x1", "pp", "qq", "rr"], "nothing about it, rr is here", "paraphrase"),
    mk("m4", "map", ["map", "beta", "gamma", "delta"], "a bitmap"),
  ];
  it("returns exact counts", () => {
    const m = measure(items);
    expect(m.wrongTotal).toBe(12);
    expect(m.caught).toBe(10);
    expect(m.catchRate).toBeCloseTo(10 / 12);
    expect(m.misses.map((x) => `${x.id}:${x.key}`)).toEqual(["m1:delta", "m3:rr"]);
    expect(m.correctTotal).toBe(4);
    expect(m.falseRejects).toBe(2);
    expect(m.falseRejectRate).toBe(0.5);
    expect(m.falseRejectList.map((x) => x.id)).toEqual(["m3", "m4"]);
  });
  it("breaks down by kind", () => {
    const m = measure(items);
    expect(m.byKind.span).toMatchObject({ wrongTotal: 9, caught: 8, correctTotal: 3, falseRejects: 1 });
    expect(m.byKind.paraphrase).toMatchObject({ wrongTotal: 3, caught: 2, correctTotal: 1, falseRejects: 1 });
  });
  it("derives one wrong key per distractor, never the key itself", () => {
    expect(measure([items[1]!]).wrongTotal).toBe(3);
  });
});
