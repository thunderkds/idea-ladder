// T015: the progress file. Export writes the learner's own review data; import merges only review log rows, each
// through rateCard, so a card state only ever changes by scheduleNext and the log still replays to every stored state.
// Import never writes evidence, lock state or another learner's rows; the file's card states are checked, never written.
import type { SQL } from "bun";
import { z } from "zod";
import { LEVEL_IDS, levelLockState } from "../shared/levels.ts";
import { FUTURE_SLACK_MS, type ImportResult, type ProgressFile } from "../shared/offline.ts";
import { RATINGS } from "../shared/review.ts";
import { listLadders, type PassedLevels } from "./ladder-view.ts";
import { stateJson } from "./offline.ts";
import { mayRate, rateCard } from "./review.ts";

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 20_000;

export async function exportProgress(sql: SQL, userId: string, now: Date, passed: PassedLevels): Promise<ProgressFile> {
  const [user] = await sql`SELECT github_id::int AS github_id, github_login FROM users WHERE id = ${userId}`;
  const states = await sql`
    SELECT card_id::text AS card_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses,
      state, last_review
    FROM card_states WHERE learner_id = ${userId} ORDER BY card_id`;
  const log = await sql`
    SELECT card_id::text AS card_id, rating, reviewed_at, elapsed_ms, idempotency_key
    FROM review_log WHERE learner_id = ${userId} ORDER BY id`;
  const levelStatus: ProgressFile["levelStatus"] = [];
  for (const { ladderId } of await listLadders(sql, userId)) {
    const locks = levelLockState(await passed(ladderId, userId));
    LEVEL_IDS.forEach((level, i) => {
      levelStatus.push({ ladderId, level, lock: locks[i] as ProgressFile["levelStatus"][number]["lock"] });
    });
  }
  return {
    format: "idea-ladder-progress",
    version: 1,
    exportedAt: now.toISOString(),
    learner: { githubId: user.github_id, login: user.github_login },
    cardStates: states.map((s: Parameters<typeof stateJson>[0] & { card_id: string }) => ({
      cardId: s.card_id,
      ...stateJson(s),
    })),
    reviewLog: log.map(
      (r: {
        card_id: string;
        rating: ProgressFile["reviewLog"][number]["rating"];
        reviewed_at: Date;
        elapsed_ms: number;
        idempotency_key: string;
      }) => ({
        cardId: r.card_id,
        rating: r.rating,
        reviewedAt: r.reviewed_at.toISOString(),
        elapsedMs: r.elapsed_ms,
        idempotencyKey: r.idempotency_key,
      }),
    ),
    levelStatus,
    evidenceHashes: [], // evidence records arrive with T012
  };
}

const isoTime = z
  .string()
  .max(40)
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/, "must be an ISO date-time")
  .refine((s) => Number.isFinite(Date.parse(s)), "must be an ISO date-time");
const cardId = z.string().min(1).max(40);
const count = z.number().int().nonnegative();
const progressFileSchema = z.object({
  format: z.literal("idea-ladder-progress"),
  version: z.literal(1),
  exportedAt: isoTime,
  learner: z.object({ githubId: z.number().int().positive(), login: z.string().max(100) }),
  cardStates: z
    .array(
      z.object({
        cardId,
        due: isoTime,
        stability: z.number().finite(),
        difficulty: z.number().finite(),
        elapsed_days: count,
        scheduled_days: count,
        learning_steps: count,
        reps: count,
        lapses: count,
        state: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
        last_review: isoTime.nullable(),
      }),
    )
    .max(MAX_IMPORT_ROWS),
  reviewLog: z.array(
    z.object({
      cardId,
      rating: z.enum(RATINGS),
      reviewedAt: isoTime,
      elapsedMs: z.number().finite().nonnegative(),
      idempotencyKey: z.string().min(1).max(200),
    }),
  ),
  levelStatus: z
    .array(
      z.object({ ladderId: z.string().max(40), level: z.string().max(4), lock: z.enum(["open", "locked", "passed"]) }),
    )
    .max(MAX_IMPORT_ROWS),
  evidenceHashes: z.array(z.string().max(200)).max(MAX_IMPORT_ROWS),
});

export type ImportProblem = {
  status: 400 | 403;
  body: { error: "invalid-file" | "unsupported-version" | "too-many-rows" | "wrong-account"; detail?: string };
};

/** Validates the whole file before anything is written. Text size is checked by the caller (413) before this. */
export function parseProgressFile(text: string, githubId: number): ProgressFile | ImportProblem {
  const bad = (error: ImportProblem["body"]["error"], detail: string): ImportProblem => ({
    status: 400,
    body: { error, detail },
  });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return bad("invalid-file", "The file is not JSON.");
  }
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    (raw as { format?: unknown }).format !== "idea-ladder-progress"
  )
    return bad("invalid-file", "This is not an Idea Ladder progress file.");
  if ((raw as { version?: unknown }).version !== 1)
    return bad("unsupported-version", "This file version is not supported. Only version 1 can be imported.");
  const log = (raw as { reviewLog?: unknown }).reviewLog;
  if (Array.isArray(log) && log.length > MAX_IMPORT_ROWS)
    return bad("too-many-rows", `The file has more than ${MAX_IMPORT_ROWS} review rows.`);
  const parsed = progressFileSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.join(".") || "file";
    return bad("invalid-file", `Invalid value at ${where}: ${issue?.message ?? "invalid"}.`.slice(0, 200));
  }
  if (parsed.data.learner.githubId !== githubId)
    return {
      status: 403,
      body: {
        error: "wrong-account",
        detail: "This file belongs to another account. Sign in with the account that exported it.",
      },
    };
  return parsed.data as ProgressFile;
}

/**
 * Applies the file's log rows per card in `reviewedAt` order through rateCard. A row is skipped when its key was
 * already used (duplicate), the card is not rateable for this learner, it is not after the card's last review on
 * the server, or it is more than 5 minutes after server time.
 */
export async function importProgress(
  sql: SQL,
  userId: string,
  file: ProgressFile,
  now: Date,
  passed: PassedLevels,
): Promise<ImportResult> {
  const result: ImportResult = {
    applied: 0,
    duplicates: 0,
    skipped: { olderThanServer: 0, notRateable: 0, futureTime: 0 },
  };
  const used = new Set<string>(
    (await sql`SELECT idempotency_key FROM review_log WHERE learner_id = ${userId}`).map(
      (r: { idempotency_key: string }) => r.idempotency_key,
    ),
  );
  const byCard = new Map<string, ProgressFile["reviewLog"]>();
  for (const row of file.reviewLog) byCard.set(row.cardId, [...(byCard.get(row.cardId) ?? []), row]);

  for (const [cardId, rows] of byCard) {
    rows.sort((a, b) => Date.parse(a.reviewedAt) - Date.parse(b.reviewedAt));
    const rateable = await mayRate(sql, userId, cardId, passed);
    for (const row of rows) {
      if (used.has(row.idempotencyKey)) {
        result.duplicates++;
        continue;
      }
      if (!rateable) {
        result.skipped.notRateable++;
        continue;
      }
      const at = Date.parse(row.reviewedAt);
      const [state] =
        await sql`SELECT last_review FROM card_states WHERE learner_id = ${userId} AND card_id = ${cardId}`;
      if (state?.last_review && at <= state.last_review.getTime()) {
        result.skipped.olderThanServer++;
        continue;
      }
      if (at > now.getTime() + FUTURE_SLACK_MS) {
        result.skipped.futureTime++;
        continue;
      }
      const res = await rateCard(sql, userId, row, now, passed);
      used.add(row.idempotencyKey);
      if (!res) result.skipped.notRateable++;
      else if (res.duplicate) result.duplicates++;
      else result.applied++;
    }
  }
  return result;
}
