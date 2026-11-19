// T013 AC 6 (option B): the optional L1 feedback — a pasted run log and a 3-sentence explanation. Feedback only:
// never scored, never in an evidence record, never a gate. L1 passes through the T012 MCQ pass test.
import type { SQL } from "bun";

export const MAX_EXPLANATION_CHARS = 600;
export const MAX_RUN_LOG_CHARS = 20_000;

export type RunFeedback = { runLog: string; explanation: string };
export type RunFeedbackProblem =
  | "invalid-request"
  | "explanation-not-3-sentences"
  | "explanation-too-long"
  | "run-log-too-long";

/** A sentence ends with ".", "!" or "?" followed by whitespace or the end of the text. */
function sentenceCount(text: string): number | undefined {
  const t = text.trim();
  if (!/[.!?]$/.test(t)) return undefined;
  return t.split(/(?<=[.!?])\s+/).filter((s) => /[^.!?\s]/.test(s)).length;
}

/** Checks the feedback body: `explanation` exactly 3 sentences and ≤ 600 chars; `runLog` optional, ≤ 20,000 chars. */
export function checkRunFeedback(body: unknown): RunFeedback | RunFeedbackProblem {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "invalid-request";
  const { explanation, runLog = "" } = body as { explanation?: unknown; runLog?: unknown };
  if (typeof explanation !== "string" || typeof runLog !== "string") return "invalid-request";
  if (runLog.length > MAX_RUN_LOG_CHARS) return "run-log-too-long";
  if (explanation.trim().length > MAX_EXPLANATION_CHARS) return "explanation-too-long";
  if (sentenceCount(explanation) !== 3) return "explanation-not-3-sentences";
  return { runLog, explanation: explanation.trim() };
}

/** Saves (or replaces) the learner's L1 feedback on an existing ladder. Writes no evidence record and unlocks nothing. */
export async function saveRunFeedback(
  sql: SQL,
  userId: string,
  ladderId: string,
  feedback: RunFeedback,
  now: Date,
): Promise<"ok" | "not-found"> {
  if (!/^[1-9][0-9]{0,17}$/.test(ladderId)) return "not-found";
  const saved = await sql`
    INSERT INTO run_feedback (learner_id, ladder_id, run_log, explanation, updated_at)
    SELECT ${userId}, id, ${feedback.runLog}, ${feedback.explanation}, ${now} FROM ladders WHERE id = ${ladderId}
    ON CONFLICT (learner_id, ladder_id) DO UPDATE
      SET run_log = EXCLUDED.run_log, explanation = EXCLUDED.explanation, updated_at = EXCLUDED.updated_at
    RETURNING 1`;
  return saved.length ? "ok" : "not-found";
}
