import type pg from 'pg';
import { LEVEL_IDS, levelLockState } from '../ladder/lock-state.js';
import { listMyLadders, readPassedLevelIds, type ReadPassed } from '../ladder/view.js';
import { initialState, scheduleNext, stateToJson, type CardState, type ReviewRating } from './scheduler.js';

export const NEW_CARDS_PER_DAY = 10;
const QUEUE_LIMIT = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ReviewDeps {
  /** Replaces the pass lookup. T012 makes the default real. */
  readPassed?: ReadPassed;
  /** Server clock. Tests pass a fixed one. */
  now?: () => Date;
}

export interface QueueCard {
  id: string;
  front: string;
  back: string;
  levelId: string;
  repoFullName: string;
  state: number;
}

export interface ReviewQueue {
  cards: QueueCard[];
  /** The earliest `due` after now among cards in unlocked levels, or null. */
  nextDue: string | null;
  /** False when the learner has no card at all in unlocked levels. */
  hasCards: boolean;
}

/** Ladder and level pairs the learner may review: ladders they started, levels not locked. */
async function unlockedPairs(pool: pg.Pool, userId: string, readPassed: ReadPassed): Promise<{ ladderIds: string[]; levelIds: string[] }> {
  const ladderIds: string[] = [];
  const levelIds: string[] = [];
  for (const ladder of await listMyLadders(pool, userId)) {
    const locks = levelLockState(await readPassed(pool, userId, ladder.id));
    LEVEL_IDS.forEach((levelId, i) => {
      if (locks[i] === 'locked') return;
      ladderIds.push(ladder.id);
      levelIds.push(levelId);
    });
  }
  return { ladderIds, levelIds };
}

const PAIRS = 'JOIN unnest($2::uuid[], $3::text[]) AS p(ladder_id, level_id) ON p.ladder_id = c.ladder_id AND p.level_id = c.level_id';
const CARD_COLUMNS = 'c.id, c.front, c.back, c.level_id, l.repo_full_name';

interface QueueRow {
  id: string;
  front: string;
  back: string;
  level_id: string;
  repo_full_name: string;
  state: number | null;
}

function toQueueCard(r: QueueRow): QueueCard {
  return { id: r.id, front: r.front, back: r.back, levelId: r.level_id, repoFullName: r.repo_full_name, state: r.state ?? 0 };
}

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Cards due now (`due <= now`) from unlocked levels, oldest due first, then new cards up to
 * NEW_CARDS_PER_DAY minus the new cards the learner already rated today (UTC day).
 */
export async function getReviewQueue(pool: pg.Pool, userId: string, deps: ReviewDeps = {}): Promise<ReviewQueue> {
  const now = (deps.now ?? (() => new Date()))();
  const { ladderIds, levelIds } = await unlockedPairs(pool, userId, deps.readPassed ?? readPassedLevelIds);
  if (ladderIds.length === 0) return { cards: [], nextDue: null, hasCards: false };
  const args = [userId, ladderIds, levelIds];

  const due = await pool.query<QueueRow>(
    `SELECT ${CARD_COLUMNS}, s.state FROM card_states s
     JOIN cards c ON c.id = s.card_id ${PAIRS} JOIN ladders l ON l.id = c.ladder_id
     WHERE s.user_id = $1 AND s.due <= $4 ORDER BY s.due, c.id LIMIT $5`,
    [...args, now, QUEUE_LIMIT],
  );
  const introduced = await pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM review_log WHERE user_id = $1 AND reviewed_at >= $2 AND (state_before->>'state')::int = 0`,
    [userId, startOfUtcDay(now)],
  );
  const newLimit = Math.max(0, NEW_CARDS_PER_DAY - Number((introduced.rows[0] as { n: string }).n));
  const fresh = await pool.query<QueueRow>(
    `SELECT ${CARD_COLUMNS}, 0 AS state FROM cards c ${PAIRS} JOIN ladders l ON l.id = c.ladder_id
     WHERE NOT EXISTS (SELECT 1 FROM card_states s WHERE s.user_id = $1 AND s.card_id = c.id)
     ORDER BY c.level_id, c.created_at, c.id LIMIT $4`,
    [...args, newLimit],
  );
  const next = await pool.query<{ next_due: Date | null; any_card: boolean }>(
    `SELECT (SELECT min(s.due) FROM card_states s JOIN cards c ON c.id = s.card_id ${PAIRS}
             WHERE s.user_id = $1 AND s.due > $4) AS next_due,
            EXISTS (SELECT 1 FROM cards c ${PAIRS}) AS any_card`,
    [...args, now],
  );
  const nextRow = next.rows[0] as { next_due: Date | null; any_card: boolean };
  return {
    cards: [...due.rows, ...fresh.rows].map(toQueueCard),
    nextDue: nextRow.next_due ? nextRow.next_due.toISOString() : null,
    hasCards: nextRow.any_card,
  };
}

export interface RatingInput {
  cardId: string;
  rating: ReviewRating;
  idempotencyKey: string;
  elapsedMs: number;
}

export type RatingResult =
  | { ok: true; replayed: boolean; state: Record<string, unknown> }
  | { ok: false; code: 'not-found' | 'key-reused' };

interface StateRow {
  due: Date;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: Date | null;
}

function rowToState(r: StateRow): CardState {
  return {
    due: r.due,
    stability: r.stability,
    difficulty: r.difficulty,
    elapsedDays: r.elapsed_days,
    scheduledDays: r.scheduled_days,
    learningSteps: r.learning_steps,
    reps: r.reps,
    lapses: r.lapses,
    state: r.state,
    lastReview: r.last_review,
  };
}

/**
 * Applies one rating: the card state and the log row are written in one transaction, using server
 * time. A second request with the same idempotency key returns the stored result and writes nothing.
 * A card of a ladder the learner has not started, or of a locked level, is `not-found`.
 */
export async function submitReviewRating(pool: pg.Pool, userId: string, input: RatingInput, deps: ReviewDeps = {}): Promise<RatingResult> {
  if (!UUID.test(input.cardId)) return { ok: false, code: 'not-found' };
  const card = await pool.query<{ ladder_id: string; level_id: string }>('SELECT ladder_id, level_id FROM cards WHERE id = $1', [input.cardId]);
  const cardRow = card.rows[0];
  if (!cardRow) return { ok: false, code: 'not-found' };
  const { ladderIds, levelIds } = await unlockedPairs(pool, userId, deps.readPassed ?? readPassedLevelIds);
  if (!ladderIds.some((id, i) => id === cardRow.ladder_id && levelIds[i] === cardRow.level_id)) return { ok: false, code: 'not-found' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialises ratings of one learner's card, so a second tab always works on the updated state.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${userId}:${input.cardId}`]);
    const existing = await client.query<{ card_id: string; state_after: Record<string, unknown> }>(
      'SELECT card_id, state_after FROM review_log WHERE user_id = $1 AND idempotency_key = $2',
      [userId, input.idempotencyKey],
    );
    const logged = existing.rows[0];
    if (logged) {
      await client.query('ROLLBACK');
      return logged.card_id === input.cardId ? { ok: true, replayed: true, state: logged.state_after } : { ok: false, code: 'key-reused' };
    }

    const now = (deps.now ?? (() => new Date()))();
    const stored = await client.query<StateRow>('SELECT * FROM card_states WHERE user_id = $1 AND card_id = $2', [userId, input.cardId]);
    const before = stored.rows[0] ? rowToState(stored.rows[0]) : initialState(now);
    const after = scheduleNext(before, input.rating, now);
    await client.query(
      `INSERT INTO card_states (user_id, card_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (user_id, card_id) DO UPDATE SET due = EXCLUDED.due, stability = EXCLUDED.stability, difficulty = EXCLUDED.difficulty,
         elapsed_days = EXCLUDED.elapsed_days, scheduled_days = EXCLUDED.scheduled_days, learning_steps = EXCLUDED.learning_steps,
         reps = EXCLUDED.reps, lapses = EXCLUDED.lapses, state = EXCLUDED.state, last_review = EXCLUDED.last_review`,
      [userId, input.cardId, after.due, after.stability, after.difficulty, after.elapsedDays, after.scheduledDays, after.learningSteps, after.reps, after.lapses, after.state, after.lastReview],
    );
    await client.query(
      `INSERT INTO review_log (user_id, card_id, rating, state_before, state_after, reviewed_at, elapsed_ms, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId, input.cardId, input.rating, stateToJson(before), stateToJson(after), now, input.elapsedMs, input.idempotencyKey],
    );
    await client.query('COMMIT');
    return { ok: true, replayed: false, state: stateToJson(after) };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    // Another learner's request cannot reach this key (unique per learner), so this is the same learner using one key for two cards.
    if ((err as { code?: string }).code === '23505') return { ok: false, code: 'key-reused' };
    throw err;
  } finally {
    client.release();
  }
}
