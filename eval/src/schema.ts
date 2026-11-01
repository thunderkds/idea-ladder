import { z } from "zod";

export const TIERS = ["trending", "medium", "lowkey"] as const;
const unique = (xs: string[]) => new Set(xs).size === xs.length;

export const goldenEntrySchema = z.object({
  fullName: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  sha: z.string().regex(/^[0-9a-f]{40}$/),
  tier: z.enum(TIERS),
  language: z.string().min(1),
  expectedCoreFiles: z.array(z.string().min(1)).min(3).max(10).refine(unique, "duplicate path"),
  expectedConcepts: z.array(z.string().min(1)).min(3).max(6).refine(unique, "duplicate concept"),
  expectedConfidence: z.enum(["low", "medium", "high"]),
  checkedBy: z.string().min(1),
  checkedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type GoldenEntry = z.infer<typeof goldenEntrySchema>;

export const goldenFileSchema = z.array(goldenEntrySchema).length(20);

/** Cross-checks labels against the recorded fixtures. Returns one message per problem, naming repo and path. */
export function checkGolden(
  entries: GoldenEntry[],
  load: (fullName: string) => { sha: string; tree: string[] } | undefined,
): string[] {
  const problems: string[] = [];
  for (const e of entries) {
    const snap = load(e.fullName);
    if (!snap) { problems.push(`${e.fullName}: no fixture recorded`); continue; }
    if (snap.sha !== e.sha) problems.push(`${e.fullName}: sha ${e.sha} differs from fixture sha ${snap.sha}`);
    const tree = new Set(snap.tree);
    for (const p of e.expectedCoreFiles) if (!tree.has(p)) problems.push(`${e.fullName}: expectedCoreFiles path "${p}" is not in the tree at ${snap.sha}`);
  }
  return problems;
}
