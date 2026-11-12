// T015: a learner's Web Push subscriptions (one row per browser endpoint) with the daily reminder hour and timezone.
// Endpoint and keys are capabilities: they are stored, never logged and never returned to any client.
import type { SQL } from "bun";
import type { PushStatus, PushSubscribeRequest } from "../shared/offline.ts";

const MAX_ENDPOINT = 2048;
const MAX_KEY = 256;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const IANA_NAME = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/; // excludes offsets like "+05:30"

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isKey = (v: unknown) => typeof v === "string" && v.length <= MAX_KEY && BASE64URL.test(v);

/**
 * The push services the server may POST to (it sends to the endpoint a learner subscribes, so nothing else is
 * accepted): Google (Chrome, Edge on Android, most Chromium browsers), Mozilla (Firefox), Apple (Safari), and
 * Microsoft's WNS (Edge on Windows). A host matches itself or any subdomain.
 */
export const PUSH_SERVICE_HOSTS = [
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "push.services.mozilla.com",
  "web.push.apple.com",
  "push.apple.com",
  "notify.windows.com",
] as const;

/** Any https URL within the length cap (enough to name the row to delete on unsubscribe). */
export function isEndpoint(v: unknown): v is string {
  if (typeof v !== "string" || v.length > MAX_ENDPOINT) return false;
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
}

/** An endpoint the server may send to: https on 443, no userinfo, a DNS name under one of `PUSH_SERVICE_HOSTS`. */
export function isPushServiceEndpoint(v: unknown): v is string {
  if (!isEndpoint(v)) return false;
  const url = new URL(v);
  const host = url.hostname; // lowercased by URL; IPv6 literals keep their brackets
  if (url.username || url.password || url.port !== "") return false; // "" also when ":443" was written
  if (host.startsWith("[") || /^[0-9.]+$/.test(host) || host === "localhost") return false;
  return PUSH_SERVICE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/** True for a time zone name Intl knows (an IANA name, not a UTC offset). */
export function isTimeZone(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 64 || !IANA_NAME.test(v)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: v });
    return true;
  } catch {
    return false;
  }
}

/** The subscribe request, or undefined when any field is missing, of the wrong kind or out of bounds. */
export function checkSubscribe(body: unknown): PushSubscribeRequest | undefined {
  if (!isObject(body) || !isObject(body.subscription) || !isObject(body.subscription.keys)) return undefined;
  const { endpoint, keys } = body.subscription as { endpoint: unknown; keys: Record<string, unknown> };
  const { hour, timezone } = body;
  if (!isPushServiceEndpoint(endpoint) || !isKey(keys.p256dh) || !isKey(keys.auth)) return undefined;
  if (typeof hour !== "number" || !Number.isInteger(hour) || hour < 0 || hour > 23 || !isTimeZone(timezone))
    return undefined;
  return {
    subscription: { endpoint, keys: { p256dh: keys.p256dh as string, auth: keys.auth as string } },
    hour,
    timezone,
  };
}

/**
 * Upsert by endpoint. An endpoint is held only by the browser that created it, so the account that subscribed last on
 * that browser owns the row (a second account on a shared browser takes it over, and `last_sent_at` starts again).
 */
export async function subscribe(sql: SQL, userId: string, req: PushSubscribeRequest): Promise<void> {
  const { endpoint, keys } = req.subscription;
  await sql`
    INSERT INTO push_subscriptions (learner_id, endpoint, p256dh, auth, reminder_hour, timezone)
    VALUES (${userId}, ${endpoint}, ${keys.p256dh}, ${keys.auth}, ${req.hour}, ${req.timezone})
    ON CONFLICT (endpoint) DO UPDATE SET
      p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, reminder_hour = EXCLUDED.reminder_hour,
      timezone = EXCLUDED.timezone,
      last_sent_at = CASE WHEN push_subscriptions.learner_id = EXCLUDED.learner_id THEN push_subscriptions.last_sent_at END,
      learner_id = EXCLUDED.learner_id`;
}

/** Deletes this learner's row for the endpoint, if any. Another learner's row is never touched. */
export async function unsubscribe(sql: SQL, userId: string, endpoint: string): Promise<void> {
  await sql`DELETE FROM push_subscriptions WHERE learner_id = ${userId} AND endpoint = ${endpoint}`;
}

/** Reminder status for this learner: their most recent subscription's hour and timezone. */
export async function pushStatus(sql: SQL, userId: string, publicKey: string | undefined): Promise<PushStatus> {
  const [row] = await sql`
    SELECT reminder_hour, timezone FROM push_subscriptions WHERE learner_id = ${userId} ORDER BY id DESC LIMIT 1`;
  return {
    configured: publicKey !== undefined,
    publicKey: publicKey ?? null,
    subscribed: !!row,
    hour: row ? row.reminder_hour : null,
    timezone: row ? row.timezone : null,
  };
}
