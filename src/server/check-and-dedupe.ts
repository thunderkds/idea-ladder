// T008 (8c): code checks on the generated levels, in order: answer-key check -> regenerate (max 2) -> verbatim
// check -> dedupe. Stores nothing: save-ladder (8d) writes. The key check is lexical; its known limits (negated
// sentence, distractor in the chunk) pass here and are left for T009's blind solver.
import type { LevelId } from "../shared/levels.ts";
import { keepDistinct } from "./dedupe.ts";
import type { Embedder } from "./embedder.ts";
import { type Card, checkMcqKey, type Dropped, LEVEL_SOURCES, type LevelChunk, type Mcq } from "./level-generator.ts";
import type { Generate } from "./model-a.ts";
import type { CallUsage } from "./repo-reader.ts";
import { copiesVerbatim, verbatimIndex } from "./verbatim-check.ts";

export const CHECK_AND_DEDUPE_STEP = "check-and-dedupe";
export const DEFAULT_DEDUPE_COSINE = 0.92;

export type GeneratedLevel = {
  level: LevelId;
  status: "generated";
  goal: string;
  passTest: { kind: string; description: string };
  cards: Card[];
  mcqs: Mcq[];
  dropped: Dropped[];
};
export type SkippedLevel = { level: LevelId; status: "skipped"; kind: "concept-only-skipped" };
export type LadderLevel = GeneratedLevel | SkippedLevel;

export type CheckAndDedupeInput = {
  /** The generate-level outputs, L0 to L4. */
  levels: LadderLevel[];
  /** Every chunk of this repo + SHA, in id order. */
  chunks: LevelChunk[];
  generate: Generate;
  embedder: Embedder;
  dedupeCosine: number;
  /** Once per model call (regenerations). */
  onUsage?: (usage: CallUsage) => void;
  /** Once per embedding call, with its input tokens. */
  onEmbedTokens?: (tokens: number) => void;
};

/** Per level: the kept cards and MCQs, and every drop with its reason (generator drops first). */
export async function checkAndDedupe(input: CheckAndDedupeInput): Promise<LadderLevel[]> {
  const { generate, onUsage } = input;
  const index = verbatimIndex(input.chunks.map((c) => c.text));
  const out: LadderLevel[] = [];
  for (const l of input.levels) {
    if (l.status !== "generated") {
      out.push(l);
      continue;
    }
    // The same chunks the level's generator got (regenerateMcq caps them the same way).
    const chunks = input.chunks.filter((c) => LEVEL_SOURCES[l.level].includes(c.source));
    const dropped = [...l.dropped];
    const mcqs: Mcq[] = [];
    for (const m of l.mcqs) {
      const kept = await checkMcqKey({ level: l.level, chunks, mcq: m, generate, onUsage });
      if (!kept) dropped.push({ item: m, reason: "key-check-failed" });
      // AC 6: the question is checked; the key and the other options are exempt.
      else if (copiesVerbatim(kept.question, index)) dropped.push({ item: kept, reason: "verbatim-copy" });
      else mcqs.push(kept);
    }
    const cards = l.cards.filter(
      (c) =>
        !(copiesVerbatim(c.front, index) || copiesVerbatim(c.back, index)) ||
        !dropped.push({ item: c, reason: "verbatim-copy" }),
    );
    out.push({ ...l, cards, mcqs, dropped });
  }
  // AC 5: one pool for the ladder, in level order; in a level MCQs come before cards, so a card that repeats an MCQ
  // is the one dropped (MCQs fill the pass-test pool).
  const pool = out.flatMap((l) =>
    l.status === "generated"
      ? [
          ...l.mcqs.map((item) => ({ l, item, text: item.question })),
          ...l.cards.map((item) => ({ l, item, text: item.front })),
        ]
      : [],
  );
  if (pool.length === 0) return out;
  const { embeddings, tokens } = await input.embedder.embedTexts(pool.map((p) => p.text));
  input.onEmbedTokens?.(tokens);
  if (embeddings.length !== pool.length)
    throw new Error(`check-and-dedupe: ${embeddings.length} embeddings for ${pool.length} items`);
  const keep = keepDistinct(embeddings, input.dedupeCosine);
  const duplicates = new Set<Card | Mcq>(pool.filter((_, i) => !keep[i]).map((p) => p.item));
  for (const { l, item } of pool) if (duplicates.has(item)) l.dropped.push({ item, reason: "duplicate" });
  return out.map((l) =>
    l.status === "generated"
      ? { ...l, mcqs: l.mcqs.filter((m) => !duplicates.has(m)), cards: l.cards.filter((c) => !duplicates.has(c)) }
      : l,
  );
}
