import type pg from 'pg';
import { z } from 'zod';
import { readPassedLevelIds } from '../ladder/view.js';
import { unlockedPairs, type ReviewDeps } from '../review/store.js';
import { MAX_CLIENT_AHEAD_MS } from '../review/sync.js';

export const EXPORT_FORMAT = 'idea-ladder-progress';
export const EXPORT_VERSION = 1;
/** Import files larger than this are rejected before they are parsed. */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

const PG_INT_MAX = 2_147_483_647;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dateString = z.iso.datetime({ offset: true });
const count = z.number().int().min(0).max(PG_INT_MAX);

const stateFields = {
  due: dateString,
  stability: z.number().min(0),
  difficulty: z.number(),
  elapsedDays: count,
  scheduledDays: count,
  learningSteps: count,
  reps: count,
  lapses: count,
  state: z.number().int().min(0).max(3),
  lastReview: dateString.nullable(),
};
const stateSchema = z.object(stateFields);
const cardStateSchema = z.object({ cardId: z.string().regex(UUID), ...stateFields });
const reviewLogSchema = z.object({
  cardId: z.string().regex(UUID),
  rating: z.number().int().min(1).max(4),
  stateBefore: stateSchema,
  stateAfter: stateSchema,
  reviewedAt: dateString,
  elapsedMs: count,
  idempotencyKey: z.string().min(1).max(128),
});

/**
 * `levelStatus` and `evidenceHashes` are accepted so a full export re-imports, and then ignored: an import
 * never writes evidence and never changes a level lock (proof stays server-side).
 */
const progressFileSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(EXPORT_VERSION),
  exportedAt: dateString,
  learner: z.string().min(1).max(128),
  cardStates: z.array(cardStateSchema).max(50_000),
  reviewLog: z.array(reviewLogSchema).max(200_000),
  levelStatus: z.array(z.unknown()).max(1_000),
  evidenceHashes: z.array(z.unknown()).max(10_000),
});

export interface ProgressExport {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  exportedAt: string;
  learner: string;
  cardStates: Array<z.infer<typeof cardStateSchema>>;
  reviewLog: Array<z.infer<typeof reviewLogSchema>>;
  /** Empty until pass tests exist (T012, T030). */
  levelStatus: unknown[];
  /** Empty until evidence records exist (T012 to T014). */
  evidenceHashes: unknown[];
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export async function exportProgress(pool: pg.Pool, userId: string, now: Date): Promise<ProgressExport> {
  const states = await pool.query(
    `SELECT card_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review
     FROM card_states WHERE user_id = $1 ORDER BY card_id`,
    [userId],
  );
  const log = await pool.query(
    `SELECT card_id, rating, state_before, state_after, reviewed_at, elapsed_ms, idempotency_key
     FROM review_log WHERE user_id = $1 ORDER BY id`,
    [userId],
  );
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    learner: userId,
    cardStates: states.rows.map((r) => ({
      cardId: r.card_id,
      due: r.due.toISOString(),
      stability: r.stability,
      difficulty: r.difficulty,
      elapsedDays: r.elapsed_days,
      scheduledDays: r.scheduled_days,
      learningSteps: r.learning_steps,
      reps: r.reps,
      lapses: r.lapses,
      state: r.state,
      lastReview: iso(r.last_review),
    })),
    reviewLog: log.rows.map((r) => ({
      cardId: r.card_id,
      rating: r.rating,
      stateBefore: r.state_before,
      stateAfter: r.state_after,
      reviewedAt: r.reviewed_at.toISOString(),
      elapsedMs: r.elapsed_ms,
      idempotencyKey: r.idempotency_key,
    })),
    levelStatus: [],
    evidenceHashes: [],
  };
}

export type ImportErrorCode = 'too-large' | 'malformed-file' | 'unsupported-version' | 'wrong-learner';

export class ImportError extends Error {
  readonly code: ImportErrorCode;
  constructor(code: ImportErrorCode) {
    super(code);
    this.name = 'ImportError';
    this.code = code;
  }
}

export interface ImportResult {
  cardStatesUpdated: number;
  cardStatesSkipped: number;
  logRowsAdded: number;
  logRowsSkipped: number;
}

const CHUNK = 1000;

/**
 * Merges review data from an export file into the signed-in learner's account, in one transaction.
 * A card state is replaced only when the imported last review is newer than the stored one. Log rows are
 * added by idempotency key. Cards that do not exist, or are not in an open level of a started ladder, are skipped.
 * Nothing else is written: no evidence record, no level lock.
 */
export async function importProgress(pool: pg.Pool, userId: string, rawText: string, deps: ReviewDeps = {}): Promise<ImportResult> {
  if (Buffer.byteLength(rawText, 'utf8') > MAX_IMPORT_BYTES) throw new ImportError('too-large');
  let json: unknown;
  try {
    json = JSON.parse(rawText);
  } catch {
    throw new ImportError('malformed-file');
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) throw new ImportError('malformed-file');
  const head = json as { format?: unknown; version?: unknown };
  if (head.format !== EXPORT_FORMAT) throw new ImportError('malformed-file');
  if (head.version !== EXPORT_VERSION) throw new ImportError('unsupported-version');
  const parsed = progressFileSchema.safeParse(json);
  if (!parsed.success) throw new ImportError('malformed-file');
  const file = parsed.data;
  if (file.learner !== userId) throw new ImportError('wrong-learner');

  // Same ceiling as a synced rating. A last review in the future makes the next rating fail in ts-fsrs.
  const latest = (deps.now ?? (() => new Date()))().getTime() + MAX_CLIENT_AHEAD_MS;
  const inFuture = (date: string | null) => date !== null && new Date(date).getTime() > latest;
  if (file.cardStates.some((c) => inFuture(c.lastReview)) || file.reviewLog.some((l) => inFuture(l.reviewedAt))) throw new ImportError('malformed-file');

  const { ladderIds, levelIds } = await unlockedPairs(pool, userId, deps.readPassed ?? readPassedLevelIds);
  const wanted = [...new Set([...file.cardStates.map((c) => c.cardId), ...file.reviewLog.map((l) => l.cardId)].map((id) => id.toLowerCase()))];
  const allowedRows =
    ladderIds.length === 0
      ? []
      : (
          await pool.query<{ id: string }>(
            `SELECT c.id FROM cards c
             JOIN unnest($1::uuid[], $2::text[]) AS p(ladder_id, level_id) ON p.ladder_id = c.ladder_id AND p.level_id = c.level_id
             WHERE c.id = ANY($3::uuid[])`,
            [ladderIds, levelIds, wanted],
          )
        ).rows;
  const allowed = new Set(allowedRows.map((r) => r.id));

  const result: ImportResult = { cardStatesUpdated: 0, cardStatesSkipped: 0, logRowsAdded: 0, logRowsSkipped: 0 };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const s of file.cardStates) {
      const cardId = s.cardId.toLowerCase();
      if (!allowed.has(cardId) || s.lastReview === null) {
        result.cardStatesSkipped += 1;
        continue;
      }
      const done = await client.query(
        `INSERT INTO card_states (user_id, card_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (user_id, card_id) DO UPDATE SET due = EXCLUDED.due, stability = EXCLUDED.stability, difficulty = EXCLUDED.difficulty,
           elapsed_days = EXCLUDED.elapsed_days, scheduled_days = EXCLUDED.scheduled_days, learning_steps = EXCLUDED.learning_steps,
           reps = EXCLUDED.reps, lapses = EXCLUDED.lapses, state = EXCLUDED.state, last_review = EXCLUDED.last_review
         WHERE card_states.last_review IS NULL OR EXCLUDED.last_review > card_states.last_review`,
        [userId, cardId, s.due, s.stability, s.difficulty, s.elapsedDays, s.scheduledDays, s.learningSteps, s.reps, s.lapses, s.state, s.lastReview],
      );
      if (done.rowCount === 1) result.cardStatesUpdated += 1;
      else result.cardStatesSkipped += 1;
    }
    const logRows = file.reviewLog.filter((l) => allowed.has(l.cardId.toLowerCase()));
    result.logRowsSkipped += file.reviewLog.length - logRows.length;
    for (let i = 0; i < logRows.length; i += CHUNK) {
      const part = logRows.slice(i, i + CHUNK);
      const done = await client.query(
        `INSERT INTO review_log (user_id, card_id, rating, state_before, state_after, reviewed_at, elapsed_ms, idempotency_key)
         SELECT $1, t.card_id, t.rating, t.state_before, t.state_after, t.reviewed_at, t.elapsed_ms, t.idempotency_key
         FROM unnest($2::uuid[], $3::smallint[], $4::jsonb[], $5::jsonb[], $6::timestamptz[], $7::int[], $8::text[])
           AS t(card_id, rating, state_before, state_after, reviewed_at, elapsed_ms, idempotency_key)
         ON CONFLICT (user_id, idempotency_key) DO NOTHING`,
        [
          userId,
          part.map((l) => l.cardId.toLowerCase()),
          part.map((l) => l.rating),
          part.map((l) => JSON.stringify(l.stateBefore)),
          part.map((l) => JSON.stringify(l.stateAfter)),
          part.map((l) => l.reviewedAt),
          part.map((l) => l.elapsedMs),
          part.map((l) => l.idempotencyKey),
        ],
      );
      result.logRowsAdded += done.rowCount ?? 0;
      result.logRowsSkipped += part.length - (done.rowCount ?? 0);
    }
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
