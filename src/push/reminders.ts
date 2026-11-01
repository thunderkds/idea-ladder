import type pg from 'pg';
import { getReviewQueue, type ReviewDeps } from '../review/store.js';

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Sends one push. A push service answer of 404 or 410 must surface as an error with `statusCode`. */
export type PushSender = (target: PushTarget, payload: string) => Promise<void>;

export const REMINDER_PAYLOAD = JSON.stringify({ title: 'Cards are due', body: 'Your daily review is ready. It takes about 5 minutes.', url: '/review' });

/** The learner's local hour (0 to 23) and calendar date (YYYY-MM-DD) at `now` in an IANA timezone. */
export function localHourAndDate(now: Date, timeZone: string): { hour: number; date: string } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { hour: Number(get('hour')), date: `${get('year')}-${get('month')}-${get('day')}` };
}

export interface ReminderRun {
  sent: number;
  removed: number;
  noneDue: number;
  failed: number;
}

interface SubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  reminder_hour: number;
  timezone: string;
  last_sent_on: string | null;
}

/**
 * The hourly tick. For each subscription whose local hour now equals its reminder hour and that has not been
 * sent to today (local date): send one push only if the learner has at least one card to review. A 404 or 410
 * from the push service deletes the subscription.
 */
export async function runReminders(pool: pg.Pool, send: PushSender, now: Date, deps: ReviewDeps = {}): Promise<ReminderRun> {
  const run: ReminderRun = { sent: 0, removed: 0, noneDue: 0, failed: 0 };
  const subs = await pool.query<SubscriptionRow>(
    `SELECT id, user_id, endpoint, p256dh, auth, reminder_hour, timezone, to_char(last_sent_on, 'YYYY-MM-DD') AS last_sent_on FROM push_subscriptions`,
  );
  const dueCache = new Map<string, boolean>();
  for (const sub of subs.rows) {
    const local = localHourAndDate(now, sub.timezone);
    if (local.hour !== sub.reminder_hour || sub.last_sent_on === local.date) continue;
    let hasCards = dueCache.get(sub.user_id);
    if (hasCards === undefined) {
      hasCards = (await getReviewQueue(pool, sub.user_id, { ...deps, now: () => now })).cards.length > 0;
      dueCache.set(sub.user_id, hasCards);
    }
    if (!hasCards) {
      run.noneDue += 1;
      continue;
    }
    try {
      await send({ endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth }, REMINDER_PAYLOAD);
      await pool.query('UPDATE push_subscriptions SET last_sent_on = $2 WHERE id = $1', [sub.id, local.date]);
      run.sent += 1;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]);
        run.removed += 1;
      } else {
        run.failed += 1;
      }
    }
  }
  return run;
}
