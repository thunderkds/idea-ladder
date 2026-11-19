// T012: the MCQ pass test. The server draws the questions, scores answers against the stored keys in code, and a pass
// writes the evidence record (which is the unlock) in the same transaction. Never calls an LLM or GitHub.
import { randomInt } from "node:crypto";
import type { SQL } from "bun";
import pkg from "../../package.json" with { type: "json" };
import { LEVEL_IDS, levelLockState } from "../shared/levels.ts";
import { type EvidenceRecord, writeEvidenceRecord } from "./evidence.ts";
import type { PassedLevels } from "./ladder-view.ts";
import { MCQ_ATTEMPT_TTL_MS, MCQ_ATTEMPTS_PER_DAY, MCQ_PASS_RATIO, MCQ_TEST_SIZE } from "./pass-test-config.ts";
import { MIN_MCQ_POOL } from "./save-ladder.ts";

const DAY_MS = 86_400_000;
/** The verifier that signs off an evidence record: this app at its package.json version. */
export const VERIFIED_BY = `verifier@${pkg.version}`;
const ID = /^[1-9][0-9]{0,17}$/; // fits a bigint

/** One question as the learner sees it: the options in the attempt's shuffled order, never the key. */
export type McqQuestion = { id: string; question: string; options: string[] };
export type McqAttempt = {
  attemptId: string;
  ladderId: string;
  level: string;
  startedAt: string;
  expiresAt: string;
  questions: McqQuestion[];
};
export type McqProblem = { status: 400 | 404 | 409 | 422 | 429; error: string; retryAt?: string };

/** The stored attempt question: the mcqs id and the shown option order (indexes into mcqs.options). */
type StoredQuestion = { id: string; order: number[] };

/** Fisher-Yates with crypto.randomInt; returns a shuffled copy. */
function shuffle<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** The level is a real level of an existing ladder and not locked for this learner. */
async function levelOpen(sql: SQL, ladderId: string, level: string, userId: string, passed: PassedLevels) {
  const i = LEVEL_IDS.indexOf(level as (typeof LEVEL_IDS)[number]);
  if (!ID.test(ladderId) || i < 0) return false;
  if ((await sql`SELECT 1 FROM ladders WHERE id = ${ladderId}`).length === 0) return false;
  return levelLockState(await passed(ladderId, userId))[i] !== "locked";
}

/**
 * AC 1, AC 6: draws min(MCQ_TEST_SIZE, pool) distinct questions from the level's pool (every saved mcqs row of that
 * ladder + level), shuffles each question's options and stores the attempt. Rate limit: MCQ_ATTEMPTS_PER_DAY started
 * attempts per learner per ladder level in a rolling 24 h.
 */
export async function startMcqAttempt(
  sql: SQL,
  userId: string,
  ladderId: string,
  level: string,
  now: Date,
  passed: PassedLevels,
): Promise<McqAttempt | McqProblem> {
  if (!(await levelOpen(sql, ladderId, level, userId, passed))) return { status: 404, error: "not-found" };
  return await sql.begin(async (tx) => {
    // Serialises this learner's starts, so two parallel starts cannot both pass the limit.
    await tx`SELECT 1 FROM users WHERE id = ${userId} FOR UPDATE`;
    const pool: string[] = (
      await tx`SELECT id::text AS id FROM mcqs WHERE ladder_id = ${ladderId} AND level = ${level} ORDER BY id`
    ).map((r: { id: string }) => r.id);
    if (pool.length < MIN_MCQ_POOL) return { status: 422, error: "pool-too-small" } as const;

    const recent: { started_at: Date; questions: StoredQuestion[] }[] = await tx`
      SELECT started_at, questions FROM mcq_attempts
      WHERE learner_id = ${userId} AND ladder_id = ${ladderId} AND level = ${level}
        AND started_at > ${new Date(now.getTime() - DAY_MS)}
      ORDER BY started_at, id`;
    if (recent.length >= MCQ_ATTEMPTS_PER_DAY) {
      // The next start is allowed once enough of the window's attempts are older than 24 h.
      const oldest = recent[recent.length - MCQ_ATTEMPTS_PER_DAY] as { started_at: Date };
      const retryAt = new Date(new Date(oldest.started_at).getTime() + DAY_MS).toISOString();
      return { status: 429, error: "too-many-attempts", retryAt } as const;
    }

    const asked = Math.min(MCQ_TEST_SIZE, pool.length);
    const [previous] = await tx`
      SELECT questions FROM mcq_attempts WHERE learner_id = ${userId} AND ladder_id = ${ladderId} AND level = ${level}
      ORDER BY started_at DESC, id DESC LIMIT 1`;
    const avoid = new Set(((previous?.questions ?? []) as StoredQuestion[]).map((q) => q.id));
    const candidates = pool.length >= 2 * asked ? pool.filter((id) => !avoid.has(id)) : pool;
    const stored: StoredQuestion[] = shuffle(candidates)
      .slice(0, asked)
      .map((id) => ({ id, order: shuffle([0, 1, 2, 3]) }));

    const [{ id: attemptId }] = await tx`
      INSERT INTO mcq_attempts (learner_id, ladder_id, level, questions, started_at)
      VALUES (${userId}, ${ladderId}, ${level}, ${stored}::jsonb, ${now}) RETURNING id::text AS id`;
    const rows: { id: string; question: string; options: string[] }[] = await tx`
      SELECT id::text AS id, question, options FROM mcqs
      WHERE id IN (SELECT x::bigint FROM jsonb_array_elements_text(${stored.map((q) => q.id)}::jsonb) AS x)`;
    const byId = new Map(rows.map((r) => [r.id, r]));
    return {
      attemptId,
      ladderId,
      level,
      startedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + MCQ_ATTEMPT_TTL_MS).toISOString(),
      questions: stored.map((q) => {
        const row = byId.get(q.id) as { question: string; options: string[] };
        return { id: q.id, question: row.question, options: q.order.map((i) => row.options[i] as string) };
      }),
    };
  });
}

export type McqResult = {
  attemptId: string;
  asked: number;
  correct: number;
  pass: boolean;
  /** The level a pass opens (null on a fail, or after L4). */
  unlockedLevel: string | null;
  /** The stored evidence record on a pass (the first one, if the level was already passed). */
  evidence: EvidenceRecord | null;
  /** On a fail: the review cards on the chunks the missed questions cite ("back to review cards"). */
  reviewCardIds: string[];
};

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

/** AC 2: pass iff correct / asked >= MCQ_PASS_RATIO, in integers. */
export function isPass(correct: number, asked: number): boolean {
  return correct * MCQ_PASS_RATIO.denominator >= asked * MCQ_PASS_RATIO.numerator;
}

/** The fewest correct answers that pass: the `pass` field of the evidence (as in the source example). */
function passMark(asked: number): number {
  return Math.ceil((asked * MCQ_PASS_RATIO.numerator) / MCQ_PASS_RATIO.denominator);
}

/**
 * AC 2-4: scores the answers against the stored keys in code. One transaction with the attempt row locked: the
 * attempt is marked submitted and, on a pass, the evidence record (which unlocks the next level) is written.
 * Foreign question ids, a second submit or a submit after MCQ_ATTEMPT_TTL_MS change nothing.
 */
export async function submitMcqAttempt(
  sql: SQL,
  userId: string,
  attemptId: string,
  body: unknown,
  now: Date,
): Promise<McqResult | McqProblem> {
  if (!ID.test(attemptId)) return { status: 404, error: "not-found" };
  const chosen = checkAnswers(body);
  return await sql.begin(async (tx) => {
    const [attempt] = await tx`
      SELECT a.ladder_id::text AS ladder_id, a.level, a.questions, a.started_at, a.submitted_at,
        u.github_login, l.repo_full_name, l.commit_sha
      FROM mcq_attempts a JOIN users u ON u.id = a.learner_id JOIN ladders l ON l.id = a.ladder_id
      WHERE a.id = ${attemptId} AND a.learner_id = ${userId}
      FOR UPDATE OF a`;
    if (!attempt) return { status: 404, error: "not-found" } as const;
    if (!chosen) return { status: 400, error: "invalid-request" } as const;
    if (attempt.submitted_at) return { status: 409, error: "already-submitted" } as const;
    if (now.getTime() - new Date(attempt.started_at).getTime() > MCQ_ATTEMPT_TTL_MS)
      return { status: 409, error: "attempt-expired" } as const;
    const stored = attempt.questions as StoredQuestion[];
    const asked = new Set(stored.map((q) => q.id));
    if ([...chosen.keys()].some((id) => !asked.has(id))) return { status: 422, error: "unknown-question" } as const;

    const keys: { id: string; options: string[]; key: string; chunk_id: string }[] = await tx`
      SELECT id::text AS id, options, key, chunk_id::text AS chunk_id FROM mcqs
      WHERE id IN (SELECT x::bigint FROM jsonb_array_elements_text(${[...asked]}::jsonb) AS x)`;
    const byId = new Map(keys.map((k) => [k.id, k]));
    const missedChunks: string[] = [];
    let correct = 0;
    for (const q of stored) {
      const mcq = byId.get(q.id);
      const choice: number | undefined = chosen.get(q.id);
      const option = choice === undefined ? undefined : q.order[choice];
      if (mcq && option !== undefined && mcq.options[option] === mcq.key) correct += 1;
      else if (mcq) missedChunks.push(mcq.chunk_id);
    }
    const pass = isPass(correct, stored.length);
    await tx`
      UPDATE mcq_attempts SET submitted_at = ${now}, correct = ${correct}, passed = ${pass} WHERE id = ${attemptId}`;

    const result: McqResult = {
      attemptId,
      asked: stored.length,
      correct,
      pass,
      unlockedLevel: null,
      evidence: null,
      reviewCardIds: [],
    };
    if (!pass) {
      const cards = await tx`
        SELECT id::text AS id FROM review_cards
        WHERE ladder_id = ${attempt.ladder_id} AND level = ${attempt.level}
          AND chunk_id IN (SELECT x::bigint FROM jsonb_array_elements_text(${missedChunks}::jsonb) AS x)
        ORDER BY id`;
      result.reviewCardIds = cards.map((c: { id: string }) => c.id);
      return result;
    }
    const { record } = await writeEvidenceRecord(tx, userId, attempt.ladder_id, {
      learner: `github:${attempt.github_login}`,
      ladder: `repo:${attempt.repo_full_name}@${String(attempt.commit_sha).slice(0, 7)}`,
      level: attempt.level,
      test: "mcq",
      evidence: { asked: stored.length, correct, pass: passMark(stored.length), questionIds: stored.map((q) => q.id) },
      verifiedBy: VERIFIED_BY,
      verifiedAt: now.toISOString(),
    });
    result.evidence = record;
    result.unlockedLevel = LEVEL_IDS[LEVEL_IDS.indexOf(attempt.level) + 1] ?? null;
    return result;
  });
}
