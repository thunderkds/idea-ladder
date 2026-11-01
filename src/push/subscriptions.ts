import type pg from 'pg';
import { z } from 'zod';

/**
 * The server posts to the endpoint a learner gives, so only the push services of the main browsers are accepted
 * (https and a known host). This stops the server being used to send requests to internal addresses.
 */
const PUSH_HOST_SUFFIXES = ['fcm.googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com'];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  // web-push reads the raw string with the legacy parser, which finds no host in `https:host/x`, so require `https://`.
  if (!endpoint.startsWith('https://')) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username !== '' || url.password !== '') return false;
  return PUSH_HOST_SUFFIXES.some((suffix) => url.hostname === suffix || url.hostname.endsWith(`.${suffix}`));
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export const subscribeSchema = z.object({
  subscription: z.object({
    endpoint: z.string().max(2048).refine(isAllowedPushEndpoint, 'endpoint is not an allowed push service'),
    keys: z.object({ p256dh: z.string().min(1).max(256), auth: z.string().min(1).max(256) }),
  }),
  reminderHour: z.number().int().min(0).max(23),
  timezone: z.string().min(1).max(64).refine(isValidTimezone, 'unknown timezone'),
});

export type SubscribeInput = z.infer<typeof subscribeSchema>;

/** Stores or updates one subscription. The same endpoint (one browser) belongs to the latest learner who subscribes with it. */
export async function saveSubscription(pool: pg.Pool, userId: string, input: SubscribeInput): Promise<void> {
  await pool.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, reminder_hour, timezone)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
       reminder_hour = EXCLUDED.reminder_hour, timezone = EXCLUDED.timezone,
       last_sent_on = CASE WHEN push_subscriptions.user_id = EXCLUDED.user_id THEN push_subscriptions.last_sent_on ELSE NULL END`,
    [userId, input.subscription.endpoint, input.subscription.keys.p256dh, input.subscription.keys.auth, input.reminderHour, input.timezone],
  );
}

export async function deleteSubscription(pool: pg.Pool, userId: string, endpoint: string): Promise<void> {
  await pool.query('DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2', [userId, endpoint]);
}
