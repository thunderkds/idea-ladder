import type { RepoSnapshot } from "./github.js";

export interface Confidence {
  score: number;
  level: "low" | "medium" | "high";
  fallbackToConcepts: boolean;
  reasons: string[];
}

/** Rule fixed in TASK_GUIDE_T001 AC 8. Integer percent arithmetic avoids float drift at the cut points. */
export function confidenceScore(s: RepoSnapshot): Confidence {
  let pct = 100;
  const reasons: string[] = [];
  if (s.readme.length < 1500) { pct -= 40; reasons.push(`README ${s.readme.length} chars < 1500 (-0.4)`); }
  if (s.openIssues === 0) { pct -= 30; reasons.push("0 open issues (-0.3)"); }
  if (s.goodFirstIssues === 0) { pct -= 10; reasons.push("0 good first issue (-0.1)"); }
  if (s.depFiles.length === 0) { pct -= 20; reasons.push("no dependency file (-0.2)"); }
  pct = Math.max(0, pct);
  if (reasons.length === 0) reasons.push("no penalties");
  const level = pct < 40 ? "low" : pct < 70 ? "medium" : "high";
  return { score: pct / 100, level, fallbackToConcepts: level === "low", reasons };
}
