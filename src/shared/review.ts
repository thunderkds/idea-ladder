// T011: the review API contract shared by the server (src/server/review.ts) and the client review screen.

export const RATINGS = ["again", "hard", "good", "easy"] as const;
export type Rating = (typeof RATINGS)[number];
export const SESSION_LIMIT_MS = 300_000; // 5:00
export type CardState = "new" | "learning" | "review" | "relearning";
export type ReviewCard = {
  cardId: string;
  ladderId: string;
  level: "L0" | "L1" | "L2" | "L3" | "L4";
  front: string;
  back: string;
  dueAt: string;
};
export type ReviewQueue = {
  nowIso: string;
  sessionLimitMs: number;
  hasCards: boolean;
  nextDueAt: string | null;
  cards: ReviewCard[];
};
/** T015: `reviewedAt` (ISO date-time) is the client's rating time; the server uses it only inside the rule in rateCard. */
export type RateRequest = {
  cardId: string;
  rating: Rating;
  idempotencyKey: string;
  elapsedMs: number;
  reviewedAt?: string;
};
/** T015: `usedClientTime` is present only when the request carried a `reviewedAt`. */
export type RateResponse = {
  cardId: string;
  dueAt: string;
  state: CardState;
  duplicate: boolean;
  usedClientTime?: boolean;
};
