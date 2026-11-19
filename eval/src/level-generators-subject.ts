// T008: the level generators as an eval subject (`--step ladder`). Per repo: chunk the fixture's README, dependency
// files, docs and the golden core files, run the five generators (L0 only on a concept-only repo), the code checks and
// dedupe, and build the same generation_report that save-ladder stores. Nothing is written to a database.
// `src/subjects/level-generators.ts` wires model A, the real embedder and GitHub reads; tests pass mocks.
import { CHECK_AND_DEDUPE_STEP, checkAndDedupe, DEFAULT_DEDUPE_COSINE, type LadderLevel } from "../../src/server/check-and-dedupe.ts";
import { chunkFiles, type SourceFile } from "../../src/server/chunker.ts";
import type { Embedder } from "../../src/server/embedder.ts";
import { generateLevel, LEVEL_SOURCES, type LevelChunk } from "../../src/server/level-generator.ts";
import type { Generate } from "../../src/server/model-a.ts";
import type { CallUsage } from "../../src/server/repo-reader.ts";
import { buildReport, type GenerationReport, MIN_MCQ_POOL } from "../../src/server/save-ladder.ts";
import { LEVEL_IDS } from "../../src/shared/levels.ts";
import { confidenceScore } from "./confidence.ts";
import type { Totals } from "./cost.ts";
import type { Fixture } from "./schema.ts";

export type LevelGeneratorsDeps = {
  generate: Generate;
  embedder: Embedder;
  /** Logs one call (model or embedding) for one repo and step; returns its USD cost (null on the subscription). */
  logCost: (fx: Fixture, step: string, usage: CallUsage) => number | null;
  /** A file's text at the fixture's SHA (core files and docs are not in the fixture); null when absent. */
  readFile: (fx: Fixture, path: string) => Promise<string | null>;
  coreFilesOf: (fullName: string) => string[];
  conceptsOf: (fullName: string) => string[];
};
export type LadderRow = { fullName: string; fallback: boolean; report: GenerationReport };

const DOC_PATH = /^docs\/.+\.md$/i;
const MAX_DOC_FILES = 20;

export function createLevelGeneratorsSubject(deps: LevelGeneratorsDeps) {
  return {
    name: "level-generators",
    async ladder(fx: Fixture): Promise<LadderRow> {
      const costByStep: Record<string, Totals> = {};
      const log = (step: string) => (u: CallUsage) => {
        const t = costByStep[step] ?? { calls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, usd: 0 };
        costByStep[step] = t;
        const usd = deps.logCost(fx, step, u);
        t.calls += 1;
        t.inputTokens += u.inputTokens;
        t.outputTokens += u.outputTokens;
        t.cachedInputTokens += u.cachedInputTokens;
        t.usd = t.usd === null || usd === null ? null : t.usd + usd;
      };
      const embedUsage = (tokens: number) => ({
        model: deps.embedder.model,
        inputTokens: tokens,
        outputTokens: 0,
        cachedInputTokens: 0,
      });
      const files: SourceFile[] = [];
      if (fx.readme) files.push({ source: "readme", path: "README.md", text: fx.readme });
      for (const [path, text] of Object.entries(fx.depFileContents)) files.push({ source: "dep", path, text });
      const blobs = fx.tree.filter((t) => t.type === "blob").map((t) => t.path);
      const docs = blobs
        .filter((p) => DOC_PATH.test(p))
        .sort()
        .slice(0, MAX_DOC_FILES);
      const wanted: [SourceFile["source"], string[]][] = [
        ["docs", docs],
        ["core", deps.coreFilesOf(fx.fullName)],
      ];
      for (const [source, paths] of wanted)
        for (const path of paths) {
          const text = await deps.readFile(fx, path);
          if (text) files.push({ source, path, text });
        }
      const chunks: LevelChunk[] = chunkFiles(fx.sha, files).map((c, i) => ({ ...c, id: i + 1 }));
      const embedded = await deps.embedder.embedTexts(chunks.map((c) => c.text));
      log("chunk-and-embed")(embedUsage(embedded.tokens));
      const fallback = confidenceScore(fx).fallbackToConcepts;
      const concepts = deps.conceptsOf(fx.fullName).map((name) => ({ name }));
      const levels: LadderLevel[] = await Promise.all(
        LEVEL_IDS.map(async (level): Promise<LadderLevel> => {
          if (fallback && level !== "L0") return { level, status: "skipped", kind: "concept-only-skipped" };
          const out = await generateLevel({
            level,
            chunks: chunks.filter((c) => LEVEL_SOURCES[level].includes(c.source)),
            ...(level === "L0" ? { concepts } : {}),
            snapshotExtras:
              level === "L2"
                ? { tree: blobs.slice(0, 200), openIssues: fx.openIssues }
                : level === "L4"
                  ? { goodFirstIssues: fx.goodFirstIssues }
                  : undefined,
            generate: deps.generate,
            onUsage: log(`generate-level-${level}`),
          });
          return { level, status: "generated", ...out };
        }),
      );
      const checked = await checkAndDedupe({
        levels,
        chunks,
        generate: deps.generate,
        embedder: deps.embedder,
        dedupeCosine: DEFAULT_DEDUPE_COSINE,
        onUsage: log(CHECK_AND_DEDUPE_STEP),
        onEmbedTokens: (tokens) => log(CHECK_AND_DEDUPE_STEP)(embedUsage(tokens)),
      });
      return { fullName: fx.fullName, fallback, report: buildReport(checked, costByStep) };
    },
  };
}

/** Pre-registered thresholds (TASK_GUIDE_T008): fixed before the first run. */
export const L3_POOL_SHARE_MIN = 0.8;
export const KEY_CHECK_DROP_MAX = 0.25;

export type LadderSummary = {
  l3Pool: { ok: number; of: number; share: number | null };
  keyCheckDrops: { dropped: number; generatedMcqs: number; share: number | null };
  /** null once any call is unpriced (claude-code): a sum would understate the cost. */
  meanUsdPerLadder: number | null;
  meanTokensPerLadder: number;
  verdicts: string[];
};

export function summarizeLadders(rows: LadderRow[]): LadderSummary {
  const nonFallback = rows.filter((r) => !r.fallback);
  const ok = nonFallback.filter(
    (r) => (r.report.levels.find((l) => l.level === "L3")?.kept.mcqs ?? 0) >= MIN_MCQ_POOL,
  ).length;
  let dropped = 0;
  let generatedMcqs = 0;
  let usd: number | null = 0;
  let tokens = 0;
  for (const r of rows) {
    for (const l of r.report.levels) {
      dropped += l.dropped["key-check-failed"] ?? 0;
      generatedMcqs += l.generated.mcqs;
    }
    for (const t of Object.values(r.report.costByStep ?? {})) {
      usd = usd === null || t.usd === null ? null : usd + t.usd;
      tokens += t.inputTokens + t.cachedInputTokens + t.outputTokens;
    }
  }
  const ratio = (a: number, b: number) => (b === 0 ? null : a / b);
  const pct = (x: number | null) => (x === null ? "n/a" : `${(x * 100).toFixed(1)}%`);
  const verdict = (pass: boolean | null) => (pass === null ? "NO DATA" : pass ? "PASS" : "MISS");
  const l3Share = ratio(ok, nonFallback.length);
  const dropShare = ratio(dropped, generatedMcqs);
  const meanUsd = usd === null || rows.length === 0 ? null : usd / rows.length;
  const meanTokens = rows.length === 0 ? 0 : tokens / rows.length;
  const cost = meanUsd === null ? "n/a (usd null: claude-code back end)" : `$${meanUsd.toFixed(4)}`;
  return {
    l3Pool: { ok, of: nonFallback.length, share: l3Share },
    keyCheckDrops: { dropped, generatedMcqs, share: dropShare },
    meanUsdPerLadder: meanUsd,
    meanTokensPerLadder: meanTokens,
    verdicts: [
      `${verdict(l3Share === null ? null : l3Share >= L3_POOL_SHARE_MIN)}: L3 pool >= ${MIN_MCQ_POOL} MCQs on ${ok}/${nonFallback.length} non-fallback repos (${pct(l3Share)}; keep if >= ${pct(L3_POOL_SHARE_MIN)})`,
      `${verdict(dropShare === null ? null : dropShare <= KEY_CHECK_DROP_MAX)}: key-check-failed drops ${dropped}/${generatedMcqs} generated MCQs (${pct(dropShare)}; keep if <= ${pct(KEY_CHECK_DROP_MAX)})`,
      `REPORTED: mean cost per ladder ${cost}, mean tokens ${Math.round(meanTokens)} (T017 sets the cap)`,
    ],
  };
}
