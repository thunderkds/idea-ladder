// T015: the offline review, push reminder and progress file contract shared by the server and the client.
import type { Rating, ReviewCard } from "./review.ts";

/** ts-fsrs Card fields with dates as ISO strings. `state`: 0 New, 1 Learning, 2 Review, 3 Relearning. */
export type CardStateJson = {
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: 0 | 1 | 2 | 3;
  last_review: string | null;
};
export const OFFLINE_WINDOW_DAYS = 7;
export const MAX_SYNC_BATCH = 200;
export const FUTURE_SLACK_MS = 300_000; // client reviewedAt may be at most 5 minutes ahead of the server
export type OfflineCard = ReviewCard & { cardState: CardStateJson | null }; // null = New (never rated)
export type OfflinePack = {
  learnerId: string;
  githubId: number;
  generatedAt: string;
  sessionLimitMs: number;
  cards: OfflineCard[];
};
export type SyncRating = {
  cardId: string;
  rating: Rating;
  idempotencyKey: string;
  elapsedMs: number;
  reviewedAt: string;
};
/** `learnerId`: the learner the queue was recorded for; when present and not the session learner, sync answers 409. */
export type SyncRequest = { learnerId?: string; ratings: SyncRating[] };
export type SyncResult = {
  idempotencyKey: string;
  cardId: string;
  status: "applied" | "duplicate" | "not-found" | "invalid";
  card?: CardStateJson;
  usedClientTime?: boolean;
};
export type SyncResponse = { results: SyncResult[] };
export type PushStatus = {
  configured: boolean;
  publicKey: string | null;
  subscribed: boolean;
  hour: number | null;
  timezone: string | null;
};
export type PushSubscribeRequest = {
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
  hour: number;
  timezone: string;
};
export type ProgressFile = {
  format: "idea-ladder-progress";
  version: 1;
  exportedAt: string;
  learner: { githubId: number; login: string };
  cardStates: Array<{ cardId: string } & CardStateJson>;
  reviewLog: Array<{ cardId: string; rating: Rating; reviewedAt: string; elapsedMs: number; idempotencyKey: string }>;
  levelStatus: Array<{ ladderId: string; level: string; lock: "open" | "locked" | "passed" }>;
  evidenceHashes: string[];
};
export type ImportResult = {
  applied: number;
  duplicates: number;
  skipped: { olderThanServer: number; notRateable: number; futureTime: number };
};
