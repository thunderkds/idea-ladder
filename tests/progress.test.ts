// T015: GET /api/progress/export and POST /api/progress/import (AC 5, AC 6, Success Criteria 6, 7).
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { noPasses } from "../src/server/ladder-view.ts";
import { rateCard } from "../src/server/review.ts";
import type { ImportResult, ProgressFile } from "../src/shared/offline.ts";
import { V0_REPOS } from "./support/github-fixtures.ts";
import { BASE, startHarness } from "./support/start-harness.ts";

const SHA: string = V0_REPOS["developit/mitt"];
const MIN = 60_000;
const DAY = 86_400_000;
const MAX_BYTES = 5 * 1024 * 1024;

let h: Awaited<ReturnType<typeof startHarness>>;
const sql = () => h.db.sql;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.db.drop();
});
beforeEach(async () => {
  await h.reset();
});

async function learner() {
  const cookie = await h.learner();
  const [u] =
    await sql()`SELECT id::text AS id, github_id::int AS gid, github_login FROM users ORDER BY users.id DESC LIMIT 1`;
  return { cookie, id: u.id as string, githubId: u.gid as number, login: u.github_login as string };
}
let repoN = 0;
async function seedLadder(startedBy?: string): Promise<string> {
  const repo = `owner/progress-${repoN++}`;
  const [row] =
    await sql()`INSERT INTO ladders (repo_full_name, commit_sha, status) VALUES (${repo}, ${SHA}, 'unverified') RETURNING id::text AS id`;
  if (startedBy)
    await sql()`INSERT INTO generation_jobs (repo_full_name, commit_sha, status, started_by) VALUES (${repo}, ${SHA}, 'fetched', ${startedBy})`;
  return row.id;
}
const seedCard = async (ladderId: string, level = "L0") =>
  (
    await sql()`INSERT INTO review_cards (ladder_id, level, front, back) VALUES (${ladderId}, ${level}, 'q', 'a') RETURNING id::text AS id`
  )[0].id as string;
/** Rates `card` `n` times, a day apart, ending 1 hour ago. */
async function history(userId: string, card: string, n: number, keyPrefix = card) {
  const start = Date.now() - (n - 1) * DAY - 60 * MIN;
  for (let i = 0; i < n; i++) {
    await rateCard(
      sql(),
      userId,
      { cardId: card, rating: i % 3 === 1 ? "hard" : "good", idempotencyKey: `${keyPrefix}-${i}`, elapsedMs: 900 + i },
      new Date(start + i * DAY),
      noPasses,
    );
  }
}
const statesOf = async (userId: string) =>
  await sql()`SELECT card_id::text AS card, due, stability, difficulty, reps, lapses, state, last_review FROM card_states WHERE learner_id = ${userId} ORDER BY card_id`;
const logOf = async (userId: string) =>
  await sql()`SELECT card_id::text AS card, rating, reviewed_at, elapsed_ms, idempotency_key FROM review_log WHERE learner_id = ${userId} ORDER BY id`;
/** Row counts of every table: an import may change only review_log and card_states. */
async function tableCounts() {
  const tables = (
    await sql()`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
  ).map((r: { table_name: string }) => r.table_name);
  const out: Record<string, number> = {};
  for (const t of tables) out[t] = Number((await sql()`SELECT count(*)::int AS n FROM ${sql()(t)}`)[0].n);
  return out;
}
const exportFile = async (cookie: string) =>
  (await (await h.get("/api/progress/export", cookie)).json()) as ProgressFile;
const postImport = (body: unknown, cookie?: string, headers: Record<string, string> = {}) =>
  h.app.request(`${BASE}/api/progress/import`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const importOk = async (body: unknown, cookie: string) => {
  const res = await postImport(body, cookie);
  expect(res.status).toBe(200);
  return (await res.json()) as ImportResult;
};
const iso = (ms: number) => new Date(ms).toISOString();

describe("T015 export (AC 5)", () => {
  test("one JSON file with the learner's own states, log, level status and no evidence yet; attachment name", async () => {
    const me = await learner();
    const other = await learner();
    const ladder = await seedLadder(me.id);
    const [a, b] = [await seedCard(ladder), await seedCard(ladder)];
    await history(me.id, a, 3);
    await history(me.id, b, 1);
    const theirLadder = await seedLadder(other.id);
    await history(other.id, await seedCard(theirLadder), 2);
    const res = await h.get("/api/progress/export", me.cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const today = new Date().toISOString().slice(0, 10);
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="idea-ladder-progress-${today}.json"`);
    const file = (await res.json()) as ProgressFile;
    expect(Object.keys(file)).toEqual([
      "format",
      "version",
      "exportedAt",
      "learner",
      "cardStates",
      "reviewLog",
      "levelStatus",
      "evidenceHashes",
    ]);
    expect(file.format).toBe("idea-ladder-progress");
    expect(file.version).toBe(1);
    expect(Math.abs(Date.parse(file.exportedAt) - Date.now())).toBeLessThan(60_000);
    expect(file.learner).toEqual({ githubId: me.githubId, login: me.login });
    expect(file.cardStates.map((s) => [s.cardId, s.reps])).toEqual([
      [a, 3],
      [b, 1],
    ]);
    const stored = (await statesOf(me.id))[0];
    expect(file.cardStates[0]).toMatchObject({
      due: stored.due.toISOString(),
      last_review: stored.last_review.toISOString(),
    });
    expect(file.reviewLog.map((r) => r.idempotencyKey)).toEqual([`${a}-0`, `${a}-1`, `${a}-2`, `${b}-0`]);
    expect(file.reviewLog[0]).toEqual({
      cardId: a,
      rating: "good",
      reviewedAt: (await logOf(me.id))[0].reviewed_at.toISOString(),
      elapsedMs: 900,
      idempotencyKey: `${a}-0`,
    });
    expect(file.levelStatus).toEqual(
      (["open", "locked", "locked", "locked", "locked"] as const).map((lock, i) => ({
        ladderId: ladder,
        level: `L${i}`,
        lock,
      })),
    );
    expect(file.evidenceHashes).toEqual([]);
  });

  test("401 signed out", async () => {
    const res = await h.get("/api/progress/export");
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("T015 import merge rules (AC 6, Success Criteria 6)", () => {
  test("export then import the same file: no change, no duplicate rows", async () => {
    const me = await learner();
    const ladder = await seedLadder(me.id);
    await history(me.id, await seedCard(ladder), 4);
    await history(me.id, await seedCard(ladder), 2);
    const file = await exportFile(me.cookie);
    const [states, log] = [await statesOf(me.id), await logOf(me.id)];
    expect(await importOk(file, me.cookie)).toEqual({
      applied: 0,
      duplicates: 6,
      skipped: { olderThanServer: 0, notRateable: 0, futureTime: 0 },
    });
    expect(await statesOf(me.id)).toEqual(states);
    expect(await logOf(me.id)).toEqual(log);
  });

  test("after storage loss, the file's log rebuilds exactly the same states through scheduleNext", async () => {
    const me = await learner();
    const ladder = await seedLadder(me.id);
    await history(me.id, await seedCard(ladder), 5);
    await history(me.id, await seedCard(ladder), 3);
    const file = await exportFile(me.cookie);
    const [states, log] = [await statesOf(me.id), await logOf(me.id)];
    await sql()`TRUNCATE review_log, card_states`;
    expect((await importOk(file, me.cookie)).applied).toBe(8);
    expect(await statesOf(me.id)).toEqual(states);
    expect(await logOf(me.id)).toEqual(log);
  });

  test("every skip reason is counted; only rows newer than the server's last review apply", async () => {
    const me = await learner();
    const other = await learner();
    const ladder = await seedLadder(me.id);
    const card = await seedCard(ladder);
    const locked = await seedCard(ladder, "L1");
    const unstarted = await seedCard(await seedLadder());
    const theirs = await seedCard(await seedLadder(other.id));
    await history(me.id, card, 2, "old"); // last review: 1 hour ago
    const [last] = await sql()`SELECT last_review FROM card_states WHERE learner_id = ${me.id}`;
    const lastMs = last.last_review.getTime();
    const file = await exportFile(me.cookie);
    const row = (cardId: string, reviewedAt: string, idempotencyKey: string) => ({
      cardId,
      rating: "good" as const,
      reviewedAt,
      elapsedMs: 1000,
      idempotencyKey,
    });
    const now = Date.now();
    file.reviewLog = [
      row(card, iso(now - 10 * MIN), "newer-2"), // applies (after newer-1, by time)
      row(card, iso(lastMs - 1), "older"), // before the server's last review
      row(card, iso(lastMs), "same-time"), // equal: not after
      row(card, iso(lastMs + MIN), "newer-1"), // applies
      row(card, iso(now + 60 * MIN), "future"), // more than 5 minutes ahead
      row(card, iso(now - 5 * MIN), "old-0"), // key already used ("old-0" from history)
      row(locked, iso(now - MIN), "locked"),
      row(unstarted, iso(now - MIN), "unstarted"),
      row(theirs, iso(now - MIN), "theirs"),
      row("987654", iso(now - MIN), "unknown"),
      row("not-a-number", iso(now - MIN), "garbage-id"),
      row(card, iso(now - 9 * MIN), "newer-1"), // the same key twice in one file
    ];
    expect(await importOk(file, me.cookie)).toEqual({
      applied: 2,
      duplicates: 2,
      skipped: { olderThanServer: 2, notRateable: 5, futureTime: 1 },
    });
    const log = await logOf(me.id);
    expect(log.map((r: { idempotency_key: string }) => r.idempotency_key)).toEqual([
      "old-0",
      "old-1",
      "newer-1",
      "newer-2",
    ]);
    expect(log[2].reviewed_at).toEqual(new Date(lastMs + MIN)); // the file's time, through rateCard
    expect(await sql()`SELECT count(*)::int AS n FROM review_log WHERE learner_id <> ${me.id}`).toEqual([{ n: 0 }]); // nothing for anyone else
    expect(await sql()`SELECT count(*)::int AS n FROM card_states WHERE learner_id = ${me.id}`).toEqual([{ n: 1 }]);
  });

  test("a card state in the file is never copied: only log rows change state", async () => {
    const me = await learner();
    const card = await seedCard(await seedLadder(me.id));
    await history(me.id, card, 1);
    const file = await exportFile(me.cookie);
    const states = await statesOf(me.id);
    file.cardStates = file.cardStates.map((s) => ({
      ...s,
      due: "2099-01-01T00:00:00.000Z",
      stability: 999,
      reps: 99,
      state: 2,
      last_review: new Date(Date.now() - MIN).toISOString(),
    }));
    file.cardStates.push({
      ...(file.cardStates[0] as ProgressFile["cardStates"][number]),
      cardId: await seedCard(await seedLadder(me.id)),
    });
    expect((await importOk(file, me.cookie)).applied).toBe(0);
    expect(await statesOf(me.id)).toEqual(states);
  });
});

describe("T015 import negatives (AC 6, Success Criteria 7)", () => {
  test("a forged file (evidence hash, L3 'passed', a locked card, an unstarted ladder) changes nothing outside review data", async () => {
    const me = await learner();
    const ladder = await seedLadder(me.id);
    const card = await seedCard(ladder);
    const l3 = await seedCard(ladder, "L3");
    const unstarted = await seedCard(await seedLadder());
    await history(me.id, card, 1);
    const file = await exportFile(me.cookie);
    file.evidenceHashes = [`sha256:${"a".repeat(64)}`];
    file.levelStatus = file.levelStatus.map((s) => ({ ...s, lock: "passed" as const }));
    file.cardStates.push({ ...(file.cardStates[0] as ProgressFile["cardStates"][number]), cardId: l3 });
    file.reviewLog.push(
      { cardId: l3, rating: "easy", reviewedAt: iso(Date.now() - MIN), elapsedMs: 1, idempotencyKey: "forged-l3" },
      {
        cardId: unstarted,
        rating: "easy",
        reviewedAt: iso(Date.now() - MIN),
        elapsedMs: 1,
        idempotencyKey: "forged-x",
      },
    );
    const before = await tableCounts();
    const view = await (await h.get(`/api/ladders/${ladder}`, me.cookie)).json();
    expect(await importOk(file, me.cookie)).toEqual({
      applied: 0,
      duplicates: 1,
      skipped: { olderThanServer: 0, notRateable: 2, futureTime: 0 },
    });
    expect(await tableCounts()).toEqual(before);
    expect(await (await h.get(`/api/ladders/${ladder}`, me.cookie)).json()).toEqual(view);
    expect((await (await h.get("/api/progress/export", me.cookie)).json()).levelStatus[3].lock).toBe("locked");
  });

  test("another learner's file: 403 wrong-account, nothing written", async () => {
    const me = await learner();
    const other = await learner();
    await history(other.id, await seedCard(await seedLadder(other.id)), 2);
    const theirs = await exportFile(other.cookie);
    await sql()`INSERT INTO generation_jobs (repo_full_name, commit_sha, status, started_by)
      SELECT repo_full_name, commit_sha, 'failed', ${me.id} FROM ladders`; // so the cards would be rateable for me
    const before = await tableCounts();
    const res = await postImport(theirs, me.cookie);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "wrong-account",
      detail: "This file belongs to another account. Sign in with the account that exported it.",
    });
    expect(await tableCounts()).toEqual(before);
  });

  test("malformed files and a wrong version: 400 with a plain detail, nothing written (whole file checked first)", async () => {
    const me = await learner();
    const card = await seedCard(await seedLadder(me.id));
    await history(me.id, card, 1);
    const good = await exportFile(me.cookie);
    good.reviewLog.push({
      cardId: card,
      rating: "good",
      reviewedAt: iso(Date.now() - MIN),
      elapsedMs: 1,
      idempotencyKey: "would-apply",
    });
    const lastBad = structuredClone(good);
    (lastBad.reviewLog as unknown[]).push({
      cardId: card,
      rating: "manual",
      reviewedAt: iso(Date.now()),
      elapsedMs: 1,
      idempotencyKey: "z",
    });
    const cases: [unknown, string][] = [
      ["not json {", "invalid-file"],
      ["[]", "invalid-file"],
      ["null", "invalid-file"],
      [{ ...good, format: "anki" }, "invalid-file"],
      [{ ...good, version: 2 }, "unsupported-version"],
      [{ ...good, version: "1" }, "unsupported-version"],
      [{ ...good, learner: undefined }, "invalid-file"],
      [{ ...good, reviewLog: "x" }, "invalid-file"],
      [{ ...good, cardStates: [{ cardId: card }] }, "invalid-file"],
      [{ ...good, exportedAt: "yesterday" }, "invalid-file"],
      [lastBad, "invalid-file"],
      [{ ...good, reviewLog: [{ ...good.reviewLog[0], elapsedMs: -1 }] }, "invalid-file"],
      [{ ...good, reviewLog: [{ ...good.reviewLog[0], idempotencyKey: "" }] }, "invalid-file"],
      [{ ...good, reviewLog: [{ ...good.reviewLog[0], reviewedAt: "2026-11-01" }] }, "invalid-file"],
    ];
    const before = await tableCounts();
    for (const [body, error] of cases) {
      const res = await postImport(body, me.cookie);
      expect([String(JSON.stringify(body)).slice(0, 60), res.status]).toEqual([
        String(JSON.stringify(body)).slice(0, 60),
        400,
      ]);
      const json = (await res.json()) as { error: string; detail: string };
      expect(json.error).toBe(error);
      expect(typeof json.detail).toBe("string");
      expect(json.detail.length).toBeGreaterThan(0);
      expect(json.detail.length).toBeLessThanOrEqual(200);
    }
    expect(await tableCounts()).toEqual(before);
  });

  test("more than 20 000 log rows: 400 too-many-rows, nothing written", async () => {
    const me = await learner();
    const card = await seedCard(await seedLadder(me.id));
    const file = await exportFile(me.cookie);
    file.reviewLog = Array.from({ length: 20_001 }, (_, i) => ({
      cardId: card,
      rating: "good" as const,
      reviewedAt: iso(Date.now() - (30_000 - i) * MIN),
      elapsedMs: 1,
      idempotencyKey: `k${i}`,
    }));
    const res = await postImport(file, me.cookie);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("too-many-rows");
    expect(await logOf(me.id)).toEqual([]);
  });

  test("over 5 MB: 413 file-too-large before parsing (a huge non-JSON body is 413, not 400); content-length checked", async () => {
    const me = await learner();
    const huge = "x".repeat(MAX_BYTES + 1);
    const res = await postImport(huge, me.cookie);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "file-too-large", detail: "The file is larger than 5 MB." });
    const exact = await postImport(`${" ".repeat(MAX_BYTES - 2)}{}`, me.cookie);
    expect(exact.status).toBe(400); // exactly 5 MB is read and parsed (and is not a valid file)
    const declared = await postImport("{}", me.cookie, { "content-length": String(MAX_BYTES + 1) });
    expect(declared.status).toBe(413);
    expect(await declared.json()).toEqual({ error: "file-too-large", detail: "The file is larger than 5 MB." });
  });

  test("401 signed out; no-store", async () => {
    const res = await postImport({});
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
