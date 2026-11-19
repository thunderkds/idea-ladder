import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { McqAttempt } from "../src/server/mcq-test.ts";
import { seedLadder, seedPool } from "./support/mcq-seed.ts";
import { BASE, startHarness } from "./support/start-harness.ts";

let h: Awaited<ReturnType<typeof startHarness>>;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.db.drop();
});
beforeEach(async () => {
  await h.reset();
});

const post = (path: string, cookie: string | undefined, body?: unknown) =>
  h.app.request(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const startPath = (ladderId: string, level: string) => `/api/ladders/${ladderId}/levels/${level}/mcq-attempts`;
const submitPath = (attemptId: string) => `/api/mcq-attempts/${attemptId}/submit`;
const correctAnswers = (a: McqAttempt) =>
  Object.fromEntries(a.questions.map((q) => [q.id, q.options.findIndex((o) => o.startsWith("key-"))]));

describe("T012 MCQ pass-test routes", () => {
  test("start -> submit a pass -> the ladder view and review see L0 passed and L1 open (real passedLevels)", async () => {
    const cookie = await h.learner();
    const ladder = await seedLadder(h.db.sql);
    await seedPool(h.db.sql, ladder, "L0", 12);
    const started = await post(startPath(ladder.ladderId, "L0"), cookie);
    expect(started.status).toBe(200);
    expect(started.headers.get("cache-control")).toBe("no-store");
    const text = await started.text();
    expect(text).not.toContain('"key"');
    const attempt = JSON.parse(text) as McqAttempt;
    expect(attempt.questions).toHaveLength(10);

    const submitted = await post(submitPath(attempt.attemptId), cookie, { answers: correctAnswers(attempt) });
    expect(submitted.status).toBe(200);
    expect(submitted.headers.get("cache-control")).toBe("no-store");
    expect(await submitted.json()).toMatchObject({ pass: true, correct: 10, unlockedLevel: "L1" });

    const view = await (await h.get(`/api/ladders/${ladder.ladderId}`, cookie)).json();
    expect(view.levels.map((l: { lock: string }) => l.lock)).toEqual(["passed", "open", "locked", "locked", "locked"]);
  });

  test("401 without a session; 404 on a locked level; 422 pool-too-small; 400 on a bad body", async () => {
    const ladder = await seedLadder(h.db.sql);
    await seedPool(h.db.sql, ladder, "L0", 7);
    await seedPool(h.db.sql, ladder, "L3", 12);
    expect((await post(startPath(ladder.ladderId, "L0"), undefined)).status).toBe(401);
    const cookie = await h.learner();
    const locked = await post(startPath(ladder.ladderId, "L3"), cookie);
    expect(locked.status).toBe(404);
    const small = await post(startPath(ladder.ladderId, "L0"), cookie);
    expect(small.status).toBe(422);
    expect(await small.json()).toEqual({ error: "pool-too-small" });
    expect((await post(submitPath("1"), undefined, { answers: {} })).status).toBe(401);
    expect((await post(submitPath("1"), cookie, "not-an-object")).status).toBe(400);
  });

  test("the 4th start in 24 h -> 429 with retryAt; another learner's attempt -> 404", async () => {
    const cookie = await h.learner();
    const ladder = await seedLadder(h.db.sql);
    await seedPool(h.db.sql, ladder, "L0", 12);
    const first = (await (await post(startPath(ladder.ladderId, "L0"), cookie)).json()) as McqAttempt;
    for (let i = 0; i < 2; i++) expect((await post(startPath(ladder.ladderId, "L0"), cookie)).status).toBe(200);
    const fourth = await post(startPath(ladder.ladderId, "L0"), cookie);
    expect(fourth.status).toBe(429);
    const body = await fourth.json();
    expect(body.error).toBe("too-many-attempts");
    expect(new Date(body.retryAt).getTime()).toBeGreaterThan(Date.now());

    const other = await h.learner();
    const foreign = await post(submitPath(first.attemptId), other, { answers: correctAnswers(first) });
    expect(foreign.status).toBe(404);
  });
});
