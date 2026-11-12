// T015: the hourly reminder tick. At each subscription's local reminder hour, one push when ≥ 1 card is due,
// at most once per 20 hours. The sender is injected: tests use a fake, main.ts the real web-push one.
import type { SQL } from "bun";
import type { Inngest } from "inngest";
import webpush from "web-push";
import type { Config } from "./config.ts";
import type { PassedLevels } from "./ladder-view.ts";
import { reviewQueue } from "./review.ts";

export const REMINDER_CRON = "0 * * * *";
const MIN_GAP_MS = 20 * 3_600_000;

export type PushTarget = { endpoint: string; keys: { p256dh: string; auth: string } };
/** Sends one push; throws on failure, with `statusCode` when the push service answered. */
export type SendPush = (target: PushTarget, payload: string) => Promise<void>;
export type ReminderDeps = { sql: SQL; sendPush: SendPush; passedLevels: PassedLevels; configured: boolean };
export type TickResult = { sent: number; deleted: number; failed: number };

/** The hour (0-23) on the wall clock in `timeZone` at `at`. */
export function localHour(at: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" })
    .formatToParts(at)
    .find((p) => p.type === "hour")?.value;
  return Number(hour);
}

export async function reminderTick(deps: ReminderDeps, now: Date): Promise<TickResult> {
  const result: TickResult = { sent: 0, deleted: 0, failed: 0 };
  if (!deps.configured) return result;
  const { sql } = deps;
  const subs = await sql`
    SELECT id::text AS id, learner_id::text AS learner_id, endpoint, p256dh, auth, reminder_hour, timezone, last_sent_at
    FROM push_subscriptions ORDER BY id`;
  for (const s of subs) {
    if (localHour(now, s.timezone) !== s.reminder_hour) continue;
    if (s.last_sent_at && now.getTime() - s.last_sent_at.getTime() <= MIN_GAP_MS) continue;
    const due = (await reviewQueue(sql, s.learner_id, now, deps.passedLevels)).cards.length;
    if (due === 0) continue;
    // Claim before sending: two overlapping ticks never both send.
    const claimed = await sql`
      UPDATE push_subscriptions SET last_sent_at = ${now}
      WHERE id = ${s.id} AND (last_sent_at IS NULL OR last_sent_at < ${new Date(now.getTime() - MIN_GAP_MS)})
      RETURNING id`;
    if (!claimed.length) continue;
    const payload = JSON.stringify({
      title: "Time for your 5-minute review",
      body: due === 1 ? "1 card is due" : `${due} cards are due`,
      url: "/review",
    });
    try {
      await deps.sendPush({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      result.sent++;
    } catch (err) {
      const statusCode = (err as { statusCode?: unknown }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await sql`DELETE FROM push_subscriptions WHERE id = ${s.id}`; // the push service says it is gone
        result.deleted++;
      } else {
        // Only the row id and the status: the endpoint and keys are capabilities and never go to a log.
        console.warn("reminder: push failed", { subscriptionId: s.id, statusCode: statusCode ?? null });
        result.failed++;
      }
    }
  }
  return result;
}

export function reminderFunction(inngest: Inngest, deps: ReminderDeps & { now: () => Date }) {
  return inngest.createFunction({ id: "reminder-tick", triggers: { cron: REMINDER_CRON } }, async ({ step }) =>
    step.run("send-reminders", () => reminderTick(deps, deps.now())),
  );
}

/** The real sender: web-push with the VAPID keys from config. */
export function webPushSender(vapid: NonNullable<Config["vapid"]>): SendPush {
  const vapidDetails = { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey };
  return async (target, payload) => {
    await webpush.sendNotification(target, payload, { vapidDetails, TTL: 4 * 3600 });
  };
}
