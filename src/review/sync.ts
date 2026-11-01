/** How far ahead of server time a client `reviewedAt` may be (clock drift). */
export const MAX_CLIENT_AHEAD_MS = 5 * 60_000;

/** The oldest client `reviewedAt` accepted. A card never rated has no last review to compare with, so this stops backdating. */
export const MAX_CLIENT_AGE_MS = 30 * 86_400_000;

export interface ResolvedReviewTime {
  reviewedAt: Date;
  /** True when the client sent a time and the server did not accept it. */
  clientTimeRejected: boolean;
}

/**
 * The time a rating is scheduled at. A client `reviewedAt` (a rating made offline) is accepted only if it is
 * after the card's last review, not older than 30 days and not later than server time + 5 minutes. Otherwise the server uses its own time.
 */
export function resolveReviewedAt(client: Date | undefined, lastReview: Date | null, serverNow: Date): ResolvedReviewTime {
  // A last review can be up to MAX_CLIENT_AHEAD_MS ahead of the server. Time must not run backwards: ts-fsrs refuses that.
  const floor = lastReview && lastReview.getTime() > serverNow.getTime() ? lastReview : serverNow;
  if (!client) return { reviewedAt: floor, clientTimeRejected: false };
  const afterLast = lastReview === null || client.getTime() > lastReview.getTime();
  const notTooOld = client.getTime() >= serverNow.getTime() - MAX_CLIENT_AGE_MS;
  const notAhead = client.getTime() <= serverNow.getTime() + MAX_CLIENT_AHEAD_MS;
  return afterLast && notTooOld && notAhead ? { reviewedAt: client, clientTimeRejected: false } : { reviewedAt: floor, clientTimeRejected: true };
}
