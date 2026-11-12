// T011: the review queue and one rating -> ts-fsrs next state -> one review log row. Never calls an LLM.
import type { SQL } from "bun";
import { LEVEL_IDS, levelLockState } from "../shared/levels.ts";
import {
  RATINGS,
  type RateRequest,
  type RateResponse,
  type ReviewCard,
  type ReviewQueue,
  SESSION_LIMIT_MS,
} from "../shared/review.ts";
import { listLadders, type PassedLevels } from "./ladder-view.ts";
import { type Card, cardState, newCard, scheduleNext } from "./scheduler.ts";

export const QUEUE_LIMIT = 50;
/** New cards (never rated) that may enter one queue. A fixed constant: the per-learner setting is on the cut list. */
export const NEW_CARDS_PER_QUEUE = 10;
const MAX_KEY_LENGTH = 200;
const CARD_ID = /^[1-9][0-9]{0,17}$/; // fits a bigint

/** `ladderId:level` for every level not locked for this learner, on every ladder they started. */
async function unlockedLevels(sql: SQL, userId: string, passed: PassedLevels) {
  const ladderIds = (await listLadders(sql, userId)).map((l) => l.ladderId);
  const keys: string[] = [];
  for (const ladderId of ladderIds) {
    const locks = levelLockState(await passed(ladderId, userId));
    LEVEL_IDS.forEach((level, i) => {
      if (locks[i] !== "locked") keys.push(`${ladderId}:${level}`);
    });
  }
  return { ladderIds, keys };
}

type QueueRow = {
  card_id: string;
  ladder_id: string;
  level: ReviewCard["level"];
  front: string;
  back: string;
  due: Date | null;
};

export async function reviewQueue(sql: SQL, userId: string, now: Date, passed: PassedLevels): Promise<ReviewQueue> {
  const { ladderIds, keys } = await unlockedLevels(sql, userId, passed);
  const [{ has_cards }] = await sql`
    SELECT EXISTS (
      SELECT 1 FROM review_cards
      WHERE ladder_id IN (SELECT x::bigint FROM jsonb_array_elements_text(${JSON.stringify(ladderIds)}::text::jsonb) AS x)
    ) AS has_cards`;
  const cards = sql`
    SELECT c.id, c.ladder_id, c.level, c.front, c.back, s.due
    FROM review_cards c
    JOIN (
      SELECT split_part(k, ':', 1)::bigint AS ladder_id, split_part(k, ':', 2) AS level
      FROM jsonb_array_elements_text(${JSON.stringify(keys)}::text::jsonb) AS k
    ) u ON u.ladder_id = c.ladder_id AND u.level = c.level
    LEFT JOIN card_states s ON s.card_id = c.id AND s.learner_id = ${userId}`;
  const rows: QueueRow[] = await sql`
    WITH cards AS (${cards})
    SELECT id::text AS card_id, ladder_id::text AS ladder_id, level, front, back, due FROM (
      (SELECT * FROM cards WHERE due <= ${now} ORDER BY due, id LIMIT ${QUEUE_LIMIT})
      UNION ALL
      (SELECT * FROM cards WHERE due IS NULL ORDER BY id LIMIT ${NEW_CARDS_PER_QUEUE})
    ) q
    ORDER BY due IS NULL, due, id
    LIMIT ${QUEUE_LIMIT}`;
  const [{ next }] = await sql`WITH cards AS (${cards}) SELECT min(due) AS next FROM cards WHERE due > ${now}`;
  return {
    nowIso: now.toISOString(),
    sessionLimitMs: SESSION_LIMIT_MS,
    hasCards: has_cards,
    nextDueAt: next ? new Date(next).toISOString() : null,
    cards: rows.map((r) => ({
      cardId: r.card_id,
      ladderId: r.ladder_id,
      level: r.level,
      front: r.front,
      back: r.back,
      dueAt: (r.due ?? now).toISOString(),
    })),
  };
}

/** The rating request, or undefined when any field is missing or of the wrong kind. */
export function checkRateRequest(body: unknown): RateRequest | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const { cardId, rating, idempotencyKey, elapsedMs } = body as Record<string, unknown>;
  if (typeof cardId !== "string") return undefined;
  if (typeof rating !== "string" || !(RATINGS as readonly string[]).includes(rating)) return undefined;
  if (typeof idempotencyKey !== "string" || !idempotencyKey || idempotencyKey.length > MAX_KEY_LENGTH) return undefined;
  if (typeof elapsedMs !== "number" || !Number.isFinite(elapsedMs) || elapsedMs < 0) return undefined;
  return { cardId, rating: rating as RateRequest["rating"], idempotencyKey, elapsedMs };
}

/** True when the card is on a ladder this learner started, in a level not locked for them. */
async function mayRate(sql: SQL, userId: string, cardId: string, passed: PassedLevels): Promise<boolean> {
  if (!CARD_ID.test(cardId)) return false;
  const [card] = await sql`SELECT ladder_id::text AS ladder_id, level FROM review_cards WHERE id = ${cardId}`;
  if (!card) return false;
  if (!(await listLadders(sql, userId)).some((l) => l.ladderId === card.ladder_id)) return false;
  const lock = levelLockState(await passed(card.ladder_id, userId))[LEVEL_IDS.indexOf(card.level)];
  return lock !== undefined && lock !== "locked";
}

const fromJson = (j: Record<string, unknown>): Card =>
  ({
    ...j,
    due: new Date(j.due as string),
    last_review: j.last_review ? new Date(j.last_review as string) : undefined,
  }) as Card;

/** The earlier answer for a key this learner already used, or undefined. */
async function earlier(sql: SQL, userId: string, key: string): Promise<RateResponse | undefined> {
  const [row] = await sql`
    SELECT card_id::text AS card_id, state_after FROM review_log WHERE learner_id = ${userId} AND idempotency_key = ${key}`;
  if (!row) return undefined;
  const after = fromJson(row.state_after);
  return { cardId: row.card_id, dueAt: after.due.toISOString(), state: cardState(after.state), duplicate: true };
}

/**
 * Applies one rating at server time `now`: locks the learner's card state row (created as New on the first rating),
 * computes the next state with ts-fsrs, writes it and one review log row in one transaction. A second tab waits on
 * the lock and rates the state the first tab wrote.
 * Undefined when the learner may not rate this card (nothing is written).
 */
export async function rateCard(
  sql: SQL,
  userId: string,
  req: RateRequest,
  now: Date,
  passed: PassedLevels,
): Promise<RateResponse | undefined> {
  if (!(await mayRate(sql, userId, req.cardId, passed))) return undefined;
  try {
    return await sql.begin(async (tx) => {
      const empty = newCard(now);
      await tx`
        INSERT INTO card_states (learner_id, card_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review)
        VALUES (${userId}, ${req.cardId}, ${empty.due}, ${empty.stability}, ${empty.difficulty}, ${empty.elapsed_days}, ${empty.scheduled_days}, ${empty.learning_steps}, ${empty.reps}, ${empty.lapses}, ${empty.state}, NULL)
        ON CONFLICT (learner_id, card_id) DO NOTHING`;
      const [s] = await tx`
        SELECT due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review
        FROM card_states WHERE learner_id = ${userId} AND card_id = ${req.cardId} FOR UPDATE`;
      const before: Card = { ...s, last_review: s.last_review ?? undefined };
      const after = scheduleNext(before, req.rating, now);
      await tx`
        UPDATE card_states SET due = ${after.due}, stability = ${after.stability}, difficulty = ${after.difficulty},
          elapsed_days = ${after.elapsed_days}, scheduled_days = ${after.scheduled_days}, learning_steps = ${after.learning_steps},
          reps = ${after.reps}, lapses = ${after.lapses}, state = ${after.state}, last_review = ${after.last_review ?? null}
        WHERE learner_id = ${userId} AND card_id = ${req.cardId}`;
      await tx`
        INSERT INTO review_log (learner_id, card_id, rating, state_before, state_after, reviewed_at, elapsed_ms, idempotency_key)
        VALUES (${userId}, ${req.cardId}, ${req.rating}, ${JSON.stringify(before)}::text::jsonb, ${JSON.stringify(after)}::text::jsonb,
          ${now}, ${req.elapsedMs}, ${req.idempotencyKey})`;
      return { cardId: req.cardId, dueAt: after.due.toISOString(), state: cardState(after.state), duplicate: false };
    });
  } catch (err) {
    // A key this learner already used (a retry, a double tap, or two at once): the review_log unique key rejected the
    // second write and rolled it back, so the card advanced once. Answer with the first write.
    if ((err as { errno?: string }).errno === "23505") {
      const dup = await earlier(sql, userId, req.idempotencyKey);
      if (dup) return dup;
    }
    throw err;
  }
}
