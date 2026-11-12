// T015: the hourly reminder tick (Inngest cron) with a fake clock and a fake push sender (Success Criteria 5).
import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { InngestTestEngine } from "@inngest/test";
import { createInngest } from "../src/server/ladder-generate.ts";
import { noPasses } from "../src/server/ladder-view.ts";
import { migrateUp } from "../src/server/migrate.ts";
import { localHour, type PushTarget, REMINDER_CRON, reminderFunction, reminderTick } from "../src/server/reminders.ts";
import { newCard, scheduleNext } from "../src/server/scheduler.ts";
import { createTestDatabase } from "./support/db.ts";

const SHA = "6b41670516ed8e8b738612f60491995470aa63b3";
const HOUR = 3_600_000;
let db: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => {
  db = await createTestDatabase();
  await migrateUp(db.sql);
});
afterAll(async () => {
  await db.drop();
});
beforeEach(async () => {
  await db.sql`TRUNCATE users, ladders, generation_jobs CASCADE`;
});

let n = 0;
/** A learner with `due` due cards (New cards) and one card due far in the future, subscribed at `hour` in `tz`. */
async function subscriber(hour: number, timezone: string, due: number, endpoint = `https://push.example/${n}`) {
  const i = n++;
  const [u] =
    await db.sql`INSERT INTO users (github_id, github_login) VALUES (${9000 + i}, ${`r${i}`}) RETURNING id::text AS id`;
  const repo = `owner/remind-${i}`;
  const [l] =
    await db.sql`INSERT INTO ladders (repo_full_name, commit_sha, status) VALUES (${repo}, ${SHA}, 'unverified') RETURNING id`;
  await db.sql`INSERT INTO generation_jobs (repo_full_name, commit_sha, status, started_by) VALUES (${repo}, ${SHA}, 'fetched', ${u.id})`;
  for (let k = 0; k < due; k++)
    await db.sql`INSERT INTO review_cards (ladder_id, level, front, back) VALUES (${l.id}, 'L0', 'q', 'a')`;
  const [later] =
    await db.sql`INSERT INTO review_cards (ladder_id, level, front, back) VALUES (${l.id}, 'L0', 'q', 'a') RETURNING id`;
  const c = {
    ...scheduleNext(newCard(new Date("2026-01-01")), "good", new Date("2026-01-01")),
    due: new Date("2040-01-01"),
  };
  await db.sql`INSERT INTO card_states (learner_id, card_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review)
    VALUES (${u.id}, ${later.id}, ${c.due}, ${c.stability}, ${c.difficulty}, ${c.elapsed_days}, ${c.scheduled_days}, ${c.learning_steps}, ${c.reps}, ${c.lapses}, ${c.state}, ${c.last_review ?? null})`;
  await db.sql`INSERT INTO push_subscriptions (learner_id, endpoint, p256dh, auth, reminder_hour, timezone)
    VALUES (${u.id}, ${endpoint}, ${`p256dh-secret-${i}`}, ${`auth-secret-${i}`}, ${hour}, ${timezone})`;
  return { id: u.id as string, endpoint };
}
type Sent = { target: PushTarget; payload: unknown };
function fakeSender(fail?: (endpoint: string) => number | undefined) {
  const sent: Sent[] = [];
  return {
    sent,
    sendPush: async (target: PushTarget, payload: string) => {
      const status = fail?.(target.endpoint);
      if (status) throw Object.assign(new Error(`push service answered ${status}`), { statusCode: status });
      sent.push({ target, payload: JSON.parse(payload) });
    },
  };
}
const deps = (sendPush: (t: PushTarget, p: string) => Promise<void>, configured = true) => ({
  sql: db.sql,
  sendPush,
  passedLevels: noPasses,
  configured,
});
const lastSent = async (endpoint: string) =>
  ((await db.sql`SELECT last_sent_at FROM push_subscriptions WHERE endpoint = ${endpoint}`)[0]?.last_sent_at ??
    null) as Date | null;
const exists = async (endpoint: string) =>
  (await db.sql`SELECT 1 FROM push_subscriptions WHERE endpoint = ${endpoint}`).length === 1;

describe("T015 reminder local hour", () => {
  test("half-hour and +14 offsets", () => {
    expect(localHour(new Date("2026-11-12T03:00:00Z"), "Asia/Kolkata")).toBe(8); // 08:30
    expect(localHour(new Date("2026-11-12T04:00:00Z"), "Asia/Kolkata")).toBe(9); // 09:30
    expect(localHour(new Date("2026-11-11T17:00:00Z"), "Pacific/Kiritimati")).toBe(7); // +14: 07:00 next day
    expect(localHour(new Date("2026-11-12T00:00:00Z"), "UTC")).toBe(0);
    expect(localHour(new Date("2026-11-12T23:00:00Z"), "UTC")).toBe(23);
  });
});

describe("T015 reminder tick (AC 4, Success Criteria 5)", () => {
  test("Asia/Kolkata at 9: nothing at 08:30 local, one push at 09:30 local with the due count", async () => {
    const s = await subscriber(9, "Asia/Kolkata", 2);
    const f = fakeSender();
    expect(await reminderTick(deps(f.sendPush), new Date("2026-11-12T03:00:00Z"))).toEqual({
      sent: 0,
      deleted: 0,
      failed: 0,
    });
    expect(f.sent).toEqual([]);
    const at = new Date("2026-11-12T04:00:00Z");
    expect(await reminderTick(deps(f.sendPush), at)).toEqual({ sent: 1, deleted: 0, failed: 0 });
    expect(f.sent).toEqual([
      {
        target: {
          endpoint: s.endpoint,
          keys: { p256dh: expect.stringMatching(/^p256dh-secret-/), auth: expect.stringMatching(/^auth-secret-/) },
        },
        payload: { title: "Time for your 5-minute review", body: "2 cards are due", url: "/review" },
      },
    ]);
    expect(await lastSent(s.endpoint)).toEqual(at);
  });

  test("Pacific/Kiritimati (+14) at 7: the push goes at 17:00 UTC the day before", async () => {
    const s = await subscriber(7, "Pacific/Kiritimati", 1);
    const f = fakeSender();
    await reminderTick(deps(f.sendPush), new Date("2026-11-11T16:00:00Z"));
    expect(f.sent).toEqual([]);
    await reminderTick(deps(f.sendPush), new Date("2026-11-11T17:00:00Z"));
    expect(f.sent.map((x) => [x.target.endpoint, (x.payload as { body: string }).body])).toEqual([
      [s.endpoint, "1 card is due"],
    ]);
  });

  test("0 due cards: no push and last_sent_at unchanged", async () => {
    const s = await subscriber(9, "UTC", 0);
    const f = fakeSender();
    expect(await reminderTick(deps(f.sendPush), new Date("2026-11-12T09:00:00Z"))).toEqual({
      sent: 0,
      deleted: 0,
      failed: 0,
    });
    expect(f.sent).toEqual([]);
    expect(await lastSent(s.endpoint)).toBeNull();
  });

  test("never twice within 20 hours: a second tick in the same hour sends nothing; > 20 h later sends again", async () => {
    const s = await subscriber(9, "UTC", 3);
    const f = fakeSender();
    const nine = new Date("2026-11-12T09:00:00Z");
    await reminderTick(deps(f.sendPush), nine);
    await reminderTick(deps(f.sendPush), nine);
    expect(f.sent.length).toBe(1);
    // exactly 20 h ago: still too recent; 20 h + 1 ms ago: send
    await db.sql`UPDATE push_subscriptions SET last_sent_at = ${new Date(nine.getTime() - 20 * HOUR)}`;
    await reminderTick(deps(f.sendPush), nine);
    expect(f.sent.length).toBe(1);
    await db.sql`UPDATE push_subscriptions SET last_sent_at = ${new Date(nine.getTime() - 20 * HOUR - 1)}`;
    await reminderTick(deps(f.sendPush), nine);
    expect(f.sent.length).toBe(2);
    await reminderTick(deps(f.sendPush), new Date(nine.getTime() + 24 * HOUR));
    expect(f.sent.length).toBe(3);
    expect(await lastSent(s.endpoint)).toEqual(new Date(nine.getTime() + 24 * HOUR));
  });

  test("404 and 410 delete the subscription; other errors keep it and log no endpoint or key", async () => {
    const gone = await subscriber(9, "UTC", 1, "https://push.example/gone-410");
    const missing = await subscriber(9, "UTC", 1, "https://push.example/missing-404");
    const flaky = await subscriber(9, "UTC", 1, "https://push.example/flaky-500");
    const fine = await subscriber(9, "UTC", 1, "https://push.example/fine");
    const codes: Record<string, number> = { [gone.endpoint]: 410, [missing.endpoint]: 404, [flaky.endpoint]: 500 };
    const f = fakeSender((e) => codes[e]);
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await reminderTick(deps(f.sendPush), new Date("2026-11-12T09:00:00Z"))).toEqual({
        sent: 1,
        deleted: 2,
        failed: 1,
      });
      const logged = JSON.stringify(warn.mock.calls);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(logged).toContain("500");
      for (const secret of ["push.example", "p256dh-secret", "auth-secret"]) expect(logged).not.toContain(secret);
    } finally {
      warn.mockRestore();
    }
    expect([
      await exists(gone.endpoint),
      await exists(missing.endpoint),
      await exists(flaky.endpoint),
      await exists(fine.endpoint),
    ]).toEqual([false, false, true, true]);
    expect(f.sent.map((x) => x.target.endpoint)).toEqual([fine.endpoint]);
  });

  test("VAPID not configured: the tick does nothing", async () => {
    const s = await subscriber(9, "UTC", 2);
    const f = fakeSender();
    expect(await reminderTick(deps(f.sendPush, false), new Date("2026-11-12T09:00:00Z"))).toEqual({
      sent: 0,
      deleted: 0,
      failed: 0,
    });
    expect(f.sent).toEqual([]);
    expect(await lastSent(s.endpoint)).toBeNull();
  });

  test("locked-level cards do not count as due", async () => {
    const s = await subscriber(9, "UTC", 0);
    const [{ ladder_id }] = await db.sql`SELECT ladder_id FROM review_cards LIMIT 1`;
    await db.sql`INSERT INTO review_cards (ladder_id, level, front, back) VALUES (${ladder_id}, 'L1', 'q', 'a')`;
    const f = fakeSender();
    await reminderTick(deps(f.sendPush), new Date("2026-11-12T09:00:00Z"));
    expect(f.sent).toEqual([]);
    expect(await lastSent(s.endpoint)).toBeNull();
  });

  test("the Inngest cron function (hourly) runs one tick at the injected time, not the event time", async () => {
    const s = await subscriber(9, "UTC", 2);
    const f = fakeSender();
    const fn = reminderFunction(createInngest(), { ...deps(f.sendPush), now: () => new Date("2026-11-12T09:00:00Z") });
    expect(REMINDER_CRON).toBe("0 * * * *");
    const t = new InngestTestEngine({
      function: fn,
      events: [
        { name: "inngest/scheduled.timer", data: { cron: REMINDER_CRON }, ts: Date.parse("2026-11-12T15:00:00Z") },
      ],
    });
    const run = await t.execute();
    expect(run.result).toEqual({ sent: 1, deleted: 0, failed: 0 });
    expect(f.sent.map((x) => x.target.endpoint)).toEqual([s.endpoint]);
  });
});
