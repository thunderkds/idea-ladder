// T014: the server side of the diff questions the learner answers: the status the PWA polls, the code-only scoring
// (`submitDiffAnswers`) and the retake. A pass writes the L2 evidence record (which unlocks L3) in the same
// transaction. NFR-002: this module imports no model and calls no LLM and no GitHub; keys never leave the server.
import type { SQL } from "bun";
import { type EvidenceRecord, writeEvidenceRecord } from "./evidence.ts";
import { type McqResult, VERIFIED_BY } from "./mcq-test.ts";
import { MCQ_ATTEMPTS_PER_DAY } from "./pass-test-config.ts";

/** Questions per set (source: "push: 5 questions on your code"). */
export const DIFF_QUESTION_COUNT = 5;
/** Pass iff correct >= DIFF_PASS_MIN of DIFF_QUESTION_COUNT (PRD FR-009: 4 of 5). */
export const DIFF_PASS_MIN = 4;
/** Reason of a set refused by the attempt limit; such a set is not counted as an attempt. */
export const TOO_MANY_ATTEMPTS = "too-many-attempts";
/** Reasons of a set the system failed (queue down, workflow out of retries): not counted as an attempt. */
const SYSTEM_FAILURES = ["queue-unavailable", "generation-failed"];
/** `diff-questions-unavailable` reasons a retake may follow (besides a `failed` set). */
const RETAKE_AFTER = new Set([...SYSTEM_FAILURES, "too-few-verified"]);

export const DIFF_RETAKE_EVENT = "ladder/diff-questions.retake";
export type DiffRetakeEvent = {
  id: string;
  name: typeof DIFF_RETAKE_EVENT;
  data: { setId: string; artifactId: string };
};
export type EmitDiffRetake = (event: DiffRetakeEvent) => Promise<void>;

export type DiffSetStatus =
  | "generating"
  | "ready"
  | "diff-questions-unavailable"
  | "diff-not-testable"
  | "passed"
  | "failed";
export type DiffQuestion = { id: string; question: string; options: string[] };
export type DiffStatusView = { status: DiffSetStatus; reason?: string; setId?: string; questions?: DiffQuestion[] };
export type DiffProblem = { status: 400 | 404 | 409 | 422 | 429 | 503; error: string; retryAt?: string };

const DAY_MS = 86_400_000;
const ID = /^[1-9][0-9]{0,17}$/;

/**
 * T012's rate limit applied to L2: MCQ_ATTEMPTS_PER_DAY question sets per learner per ladder in a rolling 24 h, over
 * every L2 artifact (a new branch is an attempt too). Returns the time the next set is allowed, or undefined.
 */
export async function attemptLimitedUntil(tx: SQL, learnerId: string, ladderId: string, now: Date) {
  const recent: { created_at: Date }[] = await tx`
    SELECT s.created_at FROM diff_question_sets s JOIN artifacts a ON a.id = s.artifact_id
    WHERE a.learner_id = ${learnerId} AND a.ladder_id = ${ladderId} AND s.created_at > ${new Date(now.getTime() - DAY_MS)}
      AND (s.reason IS NULL OR s.reason NOT IN (SELECT jsonb_array_elements_text(${[TOO_MANY_ATTEMPTS, ...SYSTEM_FAILURES]}::jsonb)))
    ORDER BY s.created_at, s.id`;
  if (recent.length < MCQ_ATTEMPTS_PER_DAY) return undefined;
  const oldest = recent[recent.length - MCQ_ATTEMPTS_PER_DAY] as { created_at: Date };
  return new Date(new Date(oldest.created_at).getTime() + DAY_MS).toISOString();
}

/** The learner's own L2 artifact, or undefined. */
async function ownArtifact(sql: SQL, userId: string, artifactId: string) {
  if (!ID.test(artifactId)) return undefined;
  const [a] = await sql`
    SELECT ladder_id::text AS ladder_id FROM artifacts WHERE id = ${artifactId} AND learner_id = ${userId} AND level = 'L2'`;
  return a as { ladder_id: string } | undefined;
}

/**
 * What the PWA polls after an L2 branch is verified: the newest set of the artifact. No set yet means the workflow has
 * not started it: `generating`. Only a `ready` set carries questions (id, question, options; never a key). Undefined
 * when the artifact is not the learner's L2 artifact (404).
 */
export async function diffQuestionStatus(
  sql: SQL,
  userId: string,
  artifactId: string,
): Promise<DiffStatusView | undefined> {
  if (!(await ownArtifact(sql, userId, artifactId))) return undefined;
  const [set] = await sql`
    SELECT id::text AS id, status, reason FROM diff_question_sets WHERE artifact_id = ${artifactId}
    ORDER BY attempt DESC LIMIT 1`;
  if (!set) return { status: "generating" };
  const view: DiffStatusView = { status: set.status, ...(set.reason ? { reason: set.reason } : {}), setId: set.id };
  if (set.status === "ready") {
    view.questions = await sql`
      SELECT id::text AS id, question, options FROM diff_questions WHERE set_id = ${set.id} ORDER BY position`;
  }
  return view;
}

/**
 * AC 6: a retake of a failed set. Within the attempt limit it adds the next set (`generating`) and sends
 * DIFF_RETAKE_EVENT, so the workflow generates a new set. Only the newest set of the artifact, and only when failed.
 */
export async function retakeDiffQuestions(
  sql: SQL,
  userId: string,
  artifactId: string,
  now: Date,
  emit: EmitDiffRetake,
): Promise<{ status: "generating"; setId: string } | DiffProblem> {
  const artifact = await ownArtifact(sql, userId, artifactId);
  if (!artifact) return { status: 404, error: "not-found" };
  const opened: DiffProblem | { setId: string } = await sql.begin(
    async (tx): Promise<DiffProblem | { setId: string }> => {
      // Serialises this learner's attempts (as T012 does), so two parallel retakes cannot both pass the limit.
      await tx`SELECT 1 FROM users WHERE id = ${userId} FOR UPDATE`;
      const [latest] = await tx`
      SELECT attempt, status, reason FROM diff_question_sets WHERE artifact_id = ${artifactId} ORDER BY attempt DESC LIMIT 1`;
      const allowed =
        latest?.status === "failed" ||
        (latest?.status === "diff-questions-unavailable" && RETAKE_AFTER.has(latest.reason));
      if (!allowed) return { status: 409, error: "retake-not-allowed" };
      const retryAt = await attemptLimitedUntil(tx, userId, artifact.ladder_id, now);
      if (retryAt) return { status: 429, error: TOO_MANY_ATTEMPTS, retryAt };
      const [row] = await tx`
      INSERT INTO diff_question_sets (artifact_id, attempt, status, created_at)
      VALUES (${artifactId}, ${latest.attempt + 1}, 'generating', ${now}) RETURNING id::text AS id`;
      return { setId: row.id as string };
    },
  );
  if ("error" in opened) return opened;
  try {
    await emit({
      id: `diff-retake-${opened.setId}`,
      name: DIFF_RETAKE_EVENT,
      data: { setId: opened.setId, artifactId },
    });
  } catch (err) {
    console.warn("diff retake: could not send", DIFF_RETAKE_EVENT, err instanceof Error ? err.message : err);
    await sql`
      UPDATE diff_question_sets SET status = 'diff-questions-unavailable', reason = 'queue-unavailable'
      WHERE id = ${opened.setId} AND status = 'generating'`;
    return { status: 503, error: "queue-unavailable" };
  }
  return { status: "generating", setId: opened.setId };
}

/** The answers body: question id -> index of the chosen option in the shown order (0-3). */
function checkAnswers(body: unknown): Map<string, number> | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const out = new Map<string, number>();
  for (const [id, choice] of Object.entries(body)) {
    if (!Number.isInteger(choice) || (choice as number) < 0 || (choice as number) > 3) return undefined;
    out.set(id, choice as number);
  }
  return out;
}

/**
 * AC 5, 6: scores the answers against the stored keys, in code. One transaction with the set row locked: the set is
 * marked passed or failed and, on a pass (correct >= DIFF_PASS_MIN), the L2 evidence record is written, which unlocks
 * L3. Another learner's set, a set that is not `ready`, a second submit or an unknown question id change nothing.
 * Returns T012's result shape (`attemptId` = the set id), so the PWA shows one result view for every test.
 */
export async function submitDiffAnswers(
  sql: SQL,
  userId: string,
  setId: string,
  body: unknown,
  now: Date,
): Promise<McqResult | DiffProblem> {
  if (!ID.test(setId)) return { status: 404, error: "not-found" };
  const chosen = checkAnswers(body);
  return await sql.begin(async (tx) => {
    const [set] = await tx`
      SELECT s.status, a.ladder_id::text AS ladder_id, a.url, a.head_sha, u.github_login, l.repo_full_name, l.commit_sha
      FROM diff_question_sets s JOIN artifacts a ON a.id = s.artifact_id JOIN users u ON u.id = a.learner_id
        JOIN ladders l ON l.id = a.ladder_id
      WHERE s.id = ${setId} AND a.learner_id = ${userId}
      FOR UPDATE OF s`;
    if (!set) return { status: 404, error: "not-found" } as const;
    if (!chosen) return { status: 400, error: "invalid-request" } as const;
    if (set.status === "passed" || set.status === "failed") return { status: 409, error: "already-submitted" } as const;
    if (set.status !== "ready") return { status: 409, error: "not-ready" } as const;
    const questions: { id: string; options: string[]; key: string }[] = await tx`
      SELECT id::text AS id, options, key FROM diff_questions WHERE set_id = ${setId} ORDER BY position`;
    const asked = new Set(questions.map((x) => x.id));
    if ([...chosen.keys()].some((id) => !asked.has(id))) return { status: 422, error: "unknown-question" } as const;

    let correct = 0;
    for (const x of questions) {
      const choice = chosen.get(x.id);
      if (choice !== undefined && x.options[choice] === x.key) correct += 1;
    }
    const pass = correct >= DIFF_PASS_MIN;
    await tx`
      UPDATE diff_question_sets SET status = ${pass ? "passed" : "failed"}, correct = ${correct}, submitted_at = ${now}
      WHERE id = ${setId}`;
    const result: McqResult = {
      attemptId: setId,
      asked: questions.length,
      correct,
      pass,
      unlockedLevel: null,
      evidence: null,
      reviewCardIds: [],
    };
    if (!pass) {
      // "fail: back to review cards": the ladder's L2 cards (a diff hunk has no review card of its own).
      const cards = await tx`
        SELECT id::text AS id FROM review_cards WHERE ladder_id = ${set.ladder_id} AND level = 'L2' ORDER BY id`;
      result.reviewCardIds = cards.map((c: { id: string }) => c.id);
      return result;
    }
    const { record } = await writeEvidenceRecord(tx, userId, set.ladder_id, {
      learner: `github:${set.github_login}`,
      ladder: `repo:${set.repo_full_name}@${String(set.commit_sha).slice(0, 7)}`,
      level: "L2",
      test: "artifact+diff-questions",
      evidence: {
        branch: set.url,
        commit: set.head_sha,
        diffQuestions: { asked: questions.length, correct, pass: DIFF_PASS_MIN },
      },
      verifiedBy: VERIFIED_BY,
      verifiedAt: now.toISOString(),
    });
    result.evidence = record as EvidenceRecord;
    result.unlockedLevel = "L3";
    return result;
  });
}
