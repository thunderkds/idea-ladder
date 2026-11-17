import { z } from "zod";

export const Tier = z.enum(["trending", "medium", "lowkey"]);
export const Confidence = z.enum(["low", "medium", "high"]);
export type ConfidenceLevel = z.infer<typeof Confidence>;

const fullName = z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "expected owner/name");
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const nonEmpty = z.string().min(1);

/** One hand-checked repo in `golden/repos.json` (AC 1). */
export const GoldenEntrySchema = z.object({
  fullName,
  sha: z.string().regex(/^[0-9a-f]{40}$/, "expected a 40-hex commit sha"),
  tier: Tier,
  language: nonEmpty,
  expectedCoreFiles: z.array(nonEmpty).min(3).max(10),
  expectedConcepts: z.array(nonEmpty).min(3).max(6),
  expectedConfidence: Confidence,
  checkedBy: nonEmpty,
  checkedAt: isoDay,
});
export type GoldenEntry = z.infer<typeof GoldenEntrySchema>;

export const GoldenSetSchema = z.array(GoldenEntrySchema).length(20);

/** A repo read once from the GitHub API at its pinned SHA (AC 3). Tests and scripts replay it offline. */
export const FixtureSchema = z.object({
  fullName,
  sha: z.string().regex(/^[0-9a-f]{40}$/),
  recordedAt: z.string(),
  defaultBranch: nonEmpty,
  stars: z.number().int().nonnegative(),
  language: z.string(),
  topics: z.array(z.string()),
  languages: z.record(z.string(), z.number()),
  readme: z.string(),
  tree: z.array(z.object({ path: nonEmpty, type: z.enum(["blob", "tree"]) })),
  /** GitHub returns `truncated: true` when the recursive tree is cut; we record it instead of hiding it. */
  treeTruncated: z.boolean(),
  /** Root-level dependency files present at the SHA. */
  depFiles: z.array(z.string()),
  depFileContents: z.record(z.string(), z.string()),
  /** Open issues on the first page (max 100), pull requests excluded. */
  openIssues: z.number().int().nonnegative(),
  goodFirstIssues: z.number().int().nonnegative(),
});
export type Fixture = z.infer<typeof FixtureSchema>;

/** USD per 1,000,000 tokens. */
export const PriceEntrySchema = z.object({
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
  cachedInput: z.number().nonnegative(),
  source: nonEmpty,
  checkedAt: isoDay,
});
export const PriceTableSchema = z.record(nonEmpty, PriceEntrySchema);
export type PriceEntry = z.infer<typeof PriceEntrySchema>;
export type PriceTable = z.infer<typeof PriceTableSchema>;

export const CostLineSchema = z.object({
  ts: z.string(),
  runId: nonEmpty,
  ladderKey: nonEmpty,
  step: nonEmpty,
  model: nonEmpty,
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  /** null: the call ran on the Claude subscription (claude-code back end) and has no per-call price. Never 0 for that. */
  usd: z.number().nonnegative().nullable(),
});
export type CostLine = z.infer<typeof CostLineSchema>;
