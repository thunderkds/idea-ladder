// T015: the offline pack (cards a learner can review with no network) and the sync of ratings queued offline.
// Every queued rating goes through rateCard, so the server recomputes each state with scheduleNext.
import type { SQL } from "bun";
import {
  type CardStateJson,
  MAX_SYNC_BATCH,
  OFFLINE_WINDOW_DAYS,
  type OfflinePack,
  type SyncResponse,
  type SyncResult,
} from "../shared/offline.ts";
import { type RateRequest, type ReviewCard, SESSION_LIMIT_MS } from "../shared/review.ts";
import type { PassedLevels } from "./ladder-view.ts";
import { checkRateRequest, NEW_CARDS_PER_QUEUE, rateCard, unlockedLevels } from "./review.ts";

export const OFFLINE_PACK_LIMIT = 200;
const DAY_MS = 86_400_000;

type StateFields = Omit<CardStateJson, "due" | "last_review"> & {
  due: Date | string;
  last_review: Date | string | null | undefined;
};
const isoOf = (d: Date | string) => new Date(d).toISOString();
/** A card_states row, or a review_log state jsonb, as the API's CardStateJson (dates as ISO strings). */
export const stateJson = (s: StateFields): CardStateJson => ({
  due: isoOf(s.due),
  stability: s.stability,
  difficulty: s.difficulty,
  elapsed_days: s.elapsed_days,
  scheduled_days: s.scheduled_days,
  learning_steps: s.learning_steps,
  reps: s.reps,
  lapses: s.lapses,
  state: s.state,
  last_review: s.last_review ? isoOf(s.last_review) : null,
});

export async function currentState(sql: SQL, userId: string, cardId: string): Promise<CardStateJson | undefined> {
  const [s] = await sql`
    SELECT due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review
    FROM card_states WHERE learner_id = ${userId} AND card_id = ${cardId}`;
  return s ? stateJson(s) : undefined;
}

/**
 * Cards of unlocked levels on ladders the learner started, due within the next 7 days, plus New cards (the queue's
 * 10-New cap); at most 200, due ascending (a New card is due now), each with its stored state (null = New).
 */
export async function offlinePack(sql: SQL, userId: string, now: Date, passed: PassedLevels): Promise<OfflinePack> {
  const { keys } = await unlockedLevels(sql, userId, passed);
  const until = new Date(now.getTime() + OFFLINE_WINDOW_DAYS * DAY_MS);
  const cards = sql`
    SELECT c.id, c.ladder_id, c.level, c.front, c.back,
      s.due, s.stability, s.difficulty, s.elapsed_days, s.scheduled_days, s.learning_steps, s.reps, s.lapses, s.state, s.last_review
    FROM review_cards c
    JOIN (
      SELECT split_part(k, ':', 1)::bigint AS ladder_id, split_part(k, ':', 2) AS level
      FROM jsonb_array_elements_text(${JSON.stringify(keys)}::text::jsonb) AS k
    ) u ON u.ladder_id = c.ladder_id AND u.level = c.level
    LEFT JOIN card_states s ON s.card_id = c.id AND s.learner_id = ${userId}`;
  const rows = await sql`
    WITH cards AS (${cards})
    SELECT q.*, q.id::text AS card_id, q.ladder_id::text AS ladder_text FROM (
      (SELECT * FROM cards WHERE due <= ${until} ORDER BY due, id LIMIT ${OFFLINE_PACK_LIMIT})
      UNION ALL
      (SELECT * FROM cards WHERE due IS NULL ORDER BY id LIMIT ${NEW_CARDS_PER_QUEUE})
    ) q
    ORDER BY coalesce(q.due, ${now}), q.due IS NULL, q.id
    LIMIT ${OFFLINE_PACK_LIMIT}`;
  const [user] = await sql`SELECT github_id::int AS github_id FROM users WHERE id = ${userId}`;
  return {
    learnerId: userId,
    githubId: user.github_id,
    generatedAt: now.toISOString(),
    sessionLimitMs: SESSION_LIMIT_MS,
    cards: rows.map((r: Record<string, unknown> & StateFields) => ({
      cardId: r.card_id as string,
      ladderId: r.ladder_text as string,
      level: r.level as ReviewCard["level"],
      front: r.front as string,
      back: r.back as string,
      dueAt: isoOf(r.due ?? now),
      cardState: r.due ? stateJson(r) : null,
    })),
  };
}

type Valid = { i: number; req: RateRequest & { reviewedAt: string } };

/**
 * Applies queued offline ratings in `reviewedAt` order (stable), each through rateCard. Results keep the request
 * order. One bad item never blocks the others. A string is a whole-request error (400; "wrong-learner" is 409:
 * the queue was recorded for another learner than the session's, so nothing is written).
 */
export async function syncRatings(
  sql: SQL,
  userId: string,
  body: unknown,
  now: Date,
  passed: PassedLevels,
): Promise<SyncResponse | "too-many" | "invalid-request" | "wrong-learner"> {
  const { ratings, learnerId } = (body ?? {}) as { ratings?: unknown; learnerId?: unknown };
  if (!body || typeof body !== "object" || Array.isArray(body) || !Array.isArray(ratings)) return "invalid-request";
  if (learnerId !== undefined && typeof learnerId !== "string") return "invalid-request";
  if (learnerId !== undefined && learnerId !== userId) return "wrong-learner";
  if (ratings.length > MAX_SYNC_BATCH) return "too-many";

  const results: SyncResult[] = [];
  const valid: Valid[] = [];
  ratings.forEach((item, i) => {
    const req = checkRateRequest(item);
    if (req?.reviewedAt !== undefined) {
      valid.push({ i, req: req as Valid["req"] });
      return;
    }
    const raw = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    results[i] = {
      idempotencyKey: typeof raw.idempotencyKey === "string" ? raw.idempotencyKey.slice(0, 200) : "",
      cardId: typeof raw.cardId === "string" ? raw.cardId.slice(0, 40) : "",
      status: "invalid",
    };
  });
  valid.sort((a, b) => Date.parse(a.req.reviewedAt) - Date.parse(b.req.reviewedAt) || a.i - b.i);

  for (const { i, req } of valid) {
    const base = { idempotencyKey: req.idempotencyKey, cardId: req.cardId };
    const res = await rateCard(sql, userId, req, now, passed);
    if (!res) {
      results[i] = { ...base, status: "not-found" };
    } else if (res.duplicate) {
      const card = await currentState(sql, userId, res.cardId);
      results[i] = { ...base, status: "duplicate", ...(card ? { card } : {}) };
    } else {
      // The state this rating wrote (its log row), not a later one another request may have written since.
      const [row] = await sql`
        SELECT state_after FROM review_log WHERE learner_id = ${userId} AND idempotency_key = ${req.idempotencyKey}`;
      results[i] = { ...base, status: "applied", card: stateJson(row.state_after), usedClientTime: res.usedClientTime };
    }
  }
  return { results };
}
