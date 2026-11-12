// T015: push reminder subscriptions: GET /api/push/status, POST /api/push/subscribe, POST /api/push/unsubscribe.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import webpush from "web-push";
import type { PushStatus, PushSubscribeRequest } from "../src/shared/offline.ts";
import { BASE, startHarness } from "./support/start-harness.ts";

const keys = webpush.generateVAPIDKeys(); // fresh per run: no key is committed
const VAPID = {
  VAPID_PUBLIC_KEY: keys.publicKey,
  VAPID_PRIVATE_KEY: keys.privateKey,
  VAPID_SUBJECT: "mailto:o@example.com",
};

let h: Awaited<ReturnType<typeof startHarness>>;
let off: Awaited<ReturnType<typeof startHarness>>;
beforeAll(async () => {
  h = await startHarness(VAPID);
  off = await startHarness();
});
afterAll(async () => {
  await h.db.drop();
  await off.db.drop();
});
beforeEach(async () => {
  await h.db.sql`TRUNCATE push_subscriptions`;
});

const post = (harness: typeof h, path: string, body: unknown, cookie?: string) =>
  harness.app.request(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const P256DH = "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM";
const AUTH = "tBHItJI5svbpez7KI4CCXg";
const subscribeBody = (endpoint = "https://fcm.googleapis.com/fcm/send/abc", hour = 9, timezone = "Europe/Berlin") =>
  ({ subscription: { endpoint, keys: { p256dh: P256DH, auth: AUTH } }, hour, timezone }) as PushSubscribeRequest;
const rows = async () =>
  await h.db
    .sql`SELECT learner_id::text AS learner, endpoint, reminder_hour, timezone, last_sent_at FROM push_subscriptions ORDER BY id`;
async function learner(harness = h) {
  const cookie = await harness.learner();
  const [u] = await harness.db.sql`SELECT id::text AS id FROM users ORDER BY users.id DESC LIMIT 1`;
  return { cookie, id: u.id as string };
}

describe("T015 push status (AC 4)", () => {
  test("VAPID unset: configured false, no public key; subscribe 503 push-not-configured, nothing stored", async () => {
    const me = await learner(off);
    const res = await off.get("/api/push/status", me.cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      configured: false,
      publicKey: null,
      subscribed: false,
      hour: null,
      timezone: null,
    });
    const sub = await post(off, "/api/push/subscribe", subscribeBody(), me.cookie);
    expect(sub.status).toBe(503);
    expect(await sub.json()).toEqual({ error: "push-not-configured", configured: false });
    expect(await off.db.sql`SELECT count(*)::int AS n FROM push_subscriptions`).toEqual([{ n: 0 }]);
  });

  test("VAPID set: the public key only (never the private key); subscribed with hour and timezone after subscribe", async () => {
    const me = await learner();
    const before = await h.get("/api/push/status", me.cookie);
    const text = await before.text();
    expect(text).not.toContain(keys.privateKey);
    expect(JSON.parse(text)).toEqual({
      configured: true,
      publicKey: keys.publicKey,
      subscribed: false,
      hour: null,
      timezone: null,
    });
    expect((await post(h, "/api/push/subscribe", subscribeBody(), me.cookie)).status).toBe(200);
    const after = (await (await h.get("/api/push/status", me.cookie)).json()) as PushStatus;
    expect(after).toEqual({
      configured: true,
      publicKey: keys.publicKey,
      subscribed: true,
      hour: 9,
      timezone: "Europe/Berlin",
    });
  });
});

describe("T015 push subscribe / unsubscribe (AC 4)", () => {
  test("subscribe stores the row; the same endpoint again updates it (one row per endpoint)", async () => {
    const me = await learner();
    const res = await post(h, "/api/push/subscribe", subscribeBody(), me.cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    await post(h, "/api/push/subscribe", subscribeBody(undefined, 21, "Asia/Kolkata"), me.cookie);
    expect(await rows()).toEqual([
      {
        learner: me.id,
        endpoint: "https://fcm.googleapis.com/fcm/send/abc",
        reminder_hour: 21,
        timezone: "Asia/Kolkata",
        last_sent_at: null,
      },
    ]);
  });

  test("bad bodies: 400 invalid-request, nothing stored", async () => {
    const me = await learner();
    const ok = subscribeBody();
    const sub = ok.subscription;
    const bad: unknown[] = [
      null,
      [],
      "not json",
      { ...ok, hour: 24 },
      { ...ok, hour: -1 },
      { ...ok, hour: 9.5 },
      { ...ok, hour: "9" },
      { ...ok, timezone: "Mars/Olympus" },
      { ...ok, timezone: "" },
      { ...ok, timezone: "+05:30" },
      { ...ok, timezone: 5 },
      { ...ok, subscription: { ...sub, endpoint: "http://push.example/x" } },
      { ...ok, subscription: { ...sub, endpoint: "not a url" } },
      { ...ok, subscription: { ...sub, endpoint: `https://push.example/${"x".repeat(2049)}` } },
      { ...ok, subscription: { ...sub, keys: { ...sub.keys, p256dh: "" } } },
      { ...ok, subscription: { ...sub, keys: { ...sub.keys, p256dh: "has spaces=" } } },
      { ...ok, subscription: { ...sub, keys: { ...sub.keys, auth: "a".repeat(257) } } },
      { ...ok, subscription: { endpoint: sub.endpoint } },
      { hour: 9, timezone: "UTC" },
    ];
    for (const body of bad) {
      const res = await post(h, "/api/push/subscribe", body, me.cookie);
      expect([JSON.stringify(body).slice(0, 80), res.status]).toEqual([JSON.stringify(body).slice(0, 80), 400]);
      expect(await res.json()).toEqual({ error: "invalid-request" });
    }
    expect(await rows()).toEqual([]);
    expect(
      (await post(h, "/api/push/subscribe", { ...ok, hour: 0, timezone: "Pacific/Kiritimati" }, me.cookie)).status,
    ).toBe(200);
    expect((await post(h, "/api/push/subscribe", { ...ok, hour: 23, timezone: "UTC" }, me.cookie)).status).toBe(200);
  });

  test("unsubscribe deletes only my own row and is idempotent; another learner cannot delete or read mine", async () => {
    const me = await learner();
    const other = await learner();
    await post(h, "/api/push/subscribe", subscribeBody("https://push.example/mine"), me.cookie);
    await post(h, "/api/push/subscribe", subscribeBody("https://push.example/theirs", 7, "UTC"), other.cookie);
    const theirTry = await post(h, "/api/push/unsubscribe", { endpoint: "https://push.example/mine" }, other.cookie);
    expect(theirTry.status).toBe(200);
    expect((await rows()).map((r: { endpoint: string }) => r.endpoint)).toEqual([
      "https://push.example/mine",
      "https://push.example/theirs",
    ]);
    const status = (await (await h.get("/api/push/status", other.cookie)).json()) as PushStatus;
    expect(status).toMatchObject({ subscribed: true, hour: 7, timezone: "UTC" });
    for (let i = 0; i < 2; i++) {
      const res = await post(h, "/api/push/unsubscribe", { endpoint: "https://push.example/mine" }, me.cookie);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    }
    expect((await rows()).map((r: { endpoint: string }) => r.endpoint)).toEqual(["https://push.example/theirs"]);
    expect(((await (await h.get("/api/push/status", me.cookie)).json()) as PushStatus).subscribed).toBe(false);
    for (const bad of [{}, { endpoint: 5 }, { endpoint: "x".repeat(2049) }, null]) {
      expect((await post(h, "/api/push/unsubscribe", bad, me.cookie)).status).toBe(400);
    }
  });

  test("one browser, a second account: the endpoint moves to the account that subscribed last", async () => {
    const first = await learner();
    const second = await learner();
    await post(h, "/api/push/subscribe", subscribeBody("https://push.example/shared"), first.cookie);
    await h.db.sql`UPDATE push_subscriptions SET last_sent_at = now()`;
    await post(h, "/api/push/subscribe", subscribeBody("https://push.example/shared", 6, "UTC"), second.cookie);
    expect(await rows()).toEqual([
      {
        learner: second.id,
        endpoint: "https://push.example/shared",
        reminder_hour: 6,
        timezone: "UTC",
        last_sent_at: null,
      },
    ]);
  });

  test("signed out: 401 on all three routes; all are no-store", async () => {
    for (const res of [
      await h.get("/api/push/status"),
      await post(h, "/api/push/subscribe", subscribeBody()),
      await post(h, "/api/push/unsubscribe", { endpoint: "https://push.example/x" }),
    ]) {
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    const me = await learner();
    expect((await h.get("/api/push/status", me.cookie)).headers.get("cache-control")).toBe("no-store");
  });
});
