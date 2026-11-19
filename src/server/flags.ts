// T016: "This question seems wrong". One flag per learner per question (review card or MCQ). The flag hides the question
// for that learner at once (filters in review.ts, offline.ts, mcq-test.ts). When FLAG_REMOVE_MIN distinct learners have
// flagged one question it becomes `removed` for everyone and one regenerate event goes to the generation workflow.
// Never touches scoring or evidence records. Never calls an LLM.
import type { SQL } from "bun";
import { FLAG_KINDS, FLAG_REASON_MAX, type FlagKind, type FlagRequest } from "../shared/flags.ts";
import { listLadders } from "./ladder-view.ts";

/** Distinct flaggers that remove a question. A fixed Supervisor choice (the source says only "frequently flagged"). */
export const FLAG_REMOVE_MIN = 3;
export const REGENERATE_EVENT = "ladder/question.regenerate";
export type RegenerateRequested = { kind: FlagKind; questionId: string; chunkId: string | null; ladderId: string };
export type EnqueueRegenerate = (data: RegenerateRequested) => Promise<void>;

const ID = /^[1-9][0-9]{0,17}$/; // fits a bigint

/** The flag request, or undefined when a field is missing or of the wrong kind. */
export function checkFlagRequest(body: unknown): FlagRequest | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const { kind, id, reason } = body as Record<string, unknown>;
  if (typeof kind !== "string" || !(FLAG_KINDS as readonly string[]).includes(kind)) return undefined;
  if (typeof id !== "string" || !ID.test(id)) return undefined;
  if (reason === undefined || reason === null) return { kind: kind as FlagKind, id };
  if (typeof reason !== "string" || [...reason].length > FLAG_REASON_MAX) return undefined;
  return { kind: kind as FlagKind, id, reason };
}

type Question = { ladder_id: string; chunk_id: string | null; status: string };

/** Locks the question row (so parallel flaggers queue up); undefined when it does not exist. */
async function lockQuestion(tx: SQL, kind: FlagKind, id: string): Promise<Question | undefined> {
  const [row] =
    kind === "card"
      ? await tx`SELECT ladder_id::text AS ladder_id, chunk_id::text AS chunk_id, status FROM review_cards WHERE id = ${id} FOR UPDATE`
      : await tx`SELECT ladder_id::text AS ladder_id, chunk_id::text AS chunk_id, status FROM mcqs WHERE id = ${id} FOR UPDATE`;
  return row;
}

/**
 * Stores the flag (a repeat is a no-op). The flag, the count, the status change and the event are one transaction under
 * a row lock on the question: the event is sent only by the flag that makes the count reach FLAG_REMOVE_MIN while the
 * question is still active, so it is sent once. If sending fails the transaction rolls back and the error is thrown.
 * "not-found": no such question, or its ladder is not one the learner started (nothing is written).
 */
export async function flagQuestion(
  sql: SQL,
  userId: string,
  req: FlagRequest,
  enqueue: EnqueueRegenerate,
): Promise<"ok" | "not-found"> {
  const started = await listLadders(sql, userId);
  return await sql.begin(async (tx) => {
    const q = await lockQuestion(tx, req.kind, req.id);
    if (!q || !started.some((l) => l.ladderId === q.ladder_id)) return "not-found";
    await tx`
      INSERT INTO question_flags (learner_id, kind, question_id, reason)
      VALUES (${userId}, ${req.kind}, ${req.id}, ${req.reason || null})
      ON CONFLICT (learner_id, kind, question_id) DO NOTHING`;
    if (q.status !== "active") return "ok";
    const [{ n }] = await tx`
      SELECT count(*)::int AS n FROM question_flags WHERE kind = ${req.kind} AND question_id = ${req.id}`;
    if (n < FLAG_REMOVE_MIN) return "ok";
    if (req.kind === "card") await tx`UPDATE review_cards SET status = 'removed' WHERE id = ${req.id}`;
    else await tx`UPDATE mcqs SET status = 'removed' WHERE id = ${req.id}`;
    await enqueue({ kind: req.kind, questionId: req.id, chunkId: q.chunk_id, ladderId: q.ladder_id });
    return "ok";
  });
}
