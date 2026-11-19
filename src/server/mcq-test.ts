// T012: the MCQ pass test. The server draws the questions, scores answers against the stored keys in code, and a pass
// writes the evidence record (which is the unlock) in the same transaction. Never calls an LLM or GitHub.
import { randomInt } from "node:crypto";
import type { SQL } from "bun";
import { LEVEL_IDS, levelLockState } from "../shared/levels.ts";
import type { PassedLevels } from "./ladder-view.ts";
import { MCQ_ATTEMPT_TTL_MS, MCQ_ATTEMPTS_PER_DAY, MCQ_TEST_SIZE } from "./pass-test-config.ts";
import { MIN_MCQ_POOL } from "./save-ladder.ts";

const DAY_MS = 86_400_000;
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
