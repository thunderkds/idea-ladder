// T016: the consumer of `ladder/question.regenerate`. An MCQ that was removed by flags gets one replacement from the same
// chunk. The replacement passes every check of the generation workflow (answer-key check, verbatim check, duplicate
// check, blind solve) before it is inserted as a new `mcqs` row; otherwise the question stays removed and nothing is
// written. A card event is a logged no-op: no card regenerator exists (cut list). Calls T008/T009 exports only.
import type { SQL } from "bun";
import type { Inngest } from "inngest";
import type { LevelId } from "../shared/levels.ts";
import { checkAnswerKey } from "./answer-key-check.ts";
import { blindSolveMcq } from "./blind-solver.ts";
import { DEFAULT_DEDUPE_JACCARD } from "./check-and-dedupe.ts";
import { keepDistinct } from "./dedupe.ts";
import { REGENERATE_EVENT, type RegenerateRequested } from "./flags.ts";
import { LEVEL_SOURCES, type LevelChunk, MAX_REGENERATIONS, type Mcq, regenerateMcq } from "./level-generator.ts";
import { type ModelADeps, ModelAFailedError, ModelAInvalidOutputError } from "./model-a.ts";
import { copiesVerbatim, verbatimIndex } from "./verbatim-check.ts";

export type RegenerateDeps = { sql: SQL; modelA: ModelADeps; modelB: ModelADeps; dedupeJaccard?: number };
export type RegenerateOutcome =
  | { status: "skipped"; reason: "card-no-regenerator" | "not-removed" | "unknown-question" }
  | { status: "inserted"; mcqId: string }
  | { status: "kept-removed"; reason: string };

const FLAGGED_REASON = "learners flagged this question as wrong, so it may be wrong or unclear; write a better one";
/** Model failures that spend one attempt; anything else (a bug, `claude` not installed) is rethrown. */
const spendsAttempt = (err: unknown) => err instanceof ModelAInvalidOutputError || err instanceof ModelAFailedError;

export async function regenerateQuestion(deps: RegenerateDeps, ev: RegenerateRequested): Promise<RegenerateOutcome> {
  const { sql } = deps;
  if (ev.kind !== "mcq") {
    console.warn(JSON.stringify({ event: "question-regenerate", ...ev, skipped: "card-no-regenerator" }));
    return { status: "skipped", reason: "card-no-regenerator" };
  }
  const [old] = await sql`
    SELECT m.level, m.question, m.options, m.key, m.chunk_id::text AS chunk_id, m.status, l.repo_full_name, l.commit_sha
    FROM mcqs m JOIN ladders l ON l.id = m.ladder_id WHERE m.id = ${ev.questionId}`;
  if (!old) return { status: "skipped", reason: "unknown-question" };
  if (old.status !== "removed") return { status: "skipped", reason: "not-removed" };
  const level = old.level as LevelId;
  const rows = await sql`
    SELECT id::text AS id, source, path, start_line, end_line, text FROM chunks
    WHERE repo_full_name = ${old.repo_full_name} AND commit_sha = ${old.commit_sha} ORDER BY id`;
  const all: LevelChunk[] = rows.map(
    (r: {
      id: string;
      source: LevelChunk["source"];
      path: string;
      start_line: number;
      end_line: number;
      text: string;
    }) => ({
      id: Number(r.id),
      source: r.source,
      path: r.path,
      startLine: r.start_line,
      endLine: r.end_line,
      text: r.text,
    }),
  );
  const levelChunks = all.filter((c) => LEVEL_SOURCES[level].includes(c.source));
  const index = verbatimIndex(all.map((c) => c.text));
  const live: { question: string }[] = await sql`
    SELECT question FROM mcqs WHERE ladder_id = ${ev.ladderId} AND status = 'active' ORDER BY id`;
  const pool = live.map((r) => r.question);

  let current: Mcq = { question: old.question, options: old.options, key: old.key, chunkId: Number(old.chunk_id) };
  let reason = FLAGGED_REASON;
  let last = "no usable replacement";
  // MAX_REGENERATIONS + 1 attempts: the same budget a generated MCQ gets (one try plus its regenerations).
  for (let attempt = 0; attempt <= MAX_REGENERATIONS; attempt++) {
    let next: Awaited<ReturnType<typeof regenerateMcq>>;
    try {
      next = await regenerateMcq({ level, chunks: levelChunks, mcq: current, reason, generate: deps.modelA.generate });
    } catch (err) {
      if (!spendsAttempt(err)) throw err;
      last = "model-a-failed";
      continue;
    }
    const r = next.mcq;
    if (!r || next.problem) {
      last = next.problem ?? "no-question";
      reason = last;
      continue;
    }
    current = r;
    const chunk = all.find((c) => c.id === r.chunkId);
    const key = chunk && checkAnswerKey({ options: r.options, key: r.key, chunk: chunk.text });
    if (!chunk || !key?.pass) {
      last = "key-check-failed";
      reason = `the key ${JSON.stringify(r.key)} must be a literal span of chunk ${r.chunkId}`;
      continue;
    }
    if (copiesVerbatim(r.question, index)) {
      last = "verbatim-copy";
      reason = "the question copies the source text; write it in your own words";
      continue;
    }
    const distinct = keepDistinct([...pool, r.question], deps.dedupeJaccard ?? DEFAULT_DEDUPE_JACCARD);
    if (!distinct[distinct.length - 1]) {
      last = "duplicate";
      reason = "the question is too close to another question of this ladder";
      continue;
    }
    let verdict: Awaited<ReturnType<typeof blindSolveMcq>>;
    try {
      verdict = await blindSolveMcq({ mcq: r, chunk: chunk.text, generate: deps.modelB.generate });
    } catch (err) {
      if (!spendsAttempt(err)) throw err;
      last = "model-b-failed";
      continue;
    }
    if (!verdict.agree) {
      last = "blind-solve-mismatch";
      reason =
        "a blind solver that saw only the chunk and the options did not pick your key; use exactly one correct option";
      continue;
    }
    const mcqId = await sql.begin(async (tx) => {
      const [{ p }] = await tx`
        SELECT coalesce(max(position), -1) + 1 AS p FROM mcqs WHERE ladder_id = ${ev.ladderId} AND level = ${level}`;
      const [{ id }] = await tx`
        INSERT INTO mcqs (ladder_id, level, position, question, options, key, chunk_id)
        VALUES (${ev.ladderId}, ${level}, ${p}, ${r.question}, ${r.options}::jsonb, ${r.key}, ${r.chunkId})
        RETURNING id::text AS id`;
      return id as string;
    });
    return { status: "inserted", mcqId };
  }
  console.warn(JSON.stringify({ event: "question-regenerate", ...ev, keptRemoved: last }));
  return { status: "kept-removed", reason: last };
}

export function questionRegenerateFunction(inngest: Inngest, deps: RegenerateDeps) {
  return inngest.createFunction(
    { id: "question-regenerate", retries: 2, triggers: { event: REGENERATE_EVENT } },
    async ({ event, step }) => {
      const data = event.data as RegenerateRequested;
      return await step.run("regenerate-question", () => regenerateQuestion(deps, data));
    },
  );
}
