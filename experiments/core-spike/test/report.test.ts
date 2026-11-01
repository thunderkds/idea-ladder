import { describe, expect, it } from "vitest";
import { buildResults, keyVerdict } from "../src/report.js";

describe("report (AC 9)", () => {
  it("renders 3 VERDICT lines and the required sections", async () => {
    const md = await buildResults(new Date("2026-11-01T00:00:00Z"));
    expect(md.split("\n").filter((l) => l.startsWith("VERDICT "))).toHaveLength(3);
    for (const h of ["Catch rate", "False-reject rate", "Tamper cases rejected", "Pinned SHA", "Known limits", "Misses (", "False rejects ("]) expect(md).toContain(h);
  });
  it("verdict arithmetic: boundaries 0.9 / 0.1 are inclusive", () => {
    expect(keyVerdict({ catchRate: 0.9, falseRejectRate: 0.1 }).keep).toBe(true);
    expect(keyVerdict({ catchRate: 0.899, falseRejectRate: 0.1 }).keep).toBe(false);
    expect(keyVerdict({ catchRate: 1, falseRejectRate: 0.101 }).keep).toBe(false);
    expect(keyVerdict({ catchRate: 0.5, falseRejectRate: 0 }).line).toContain("blind solver or entailment check required");
  });
});
