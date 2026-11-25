// T014 AC 1-7 and Success Criteria 1-6: diff questions after L2. Inngest test engine + test Postgres; model A is a
// scripted `generate`, model B an AI SDK mock language model; GitHub is a hand-built compare fixture. No network.
import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { dirname, resolve } from "node:path";
import { InngestTestEngine } from "@inngest/test";
import { APICallError } from "ai";
import { createApp } from "../src/server/app.ts";
import { L2_ARTIFACT_EVENT } from "../src/server/artifacts.ts";
import { signInUser } from "../src/server/auth.ts";
import { BLIND_CHUNK_CHARS } from "../src/server/blind-solver.ts";
import { loadConfig } from "../src/server/config.ts";
import {
  DIFF_PASS_MIN,
  DIFF_RETAKE_EVENT,
  type DiffRetakeEvent,
  diffQuestionStatus,
  retakeDiffQuestions,
  submitDiffAnswers,
} from "../src/server/diff-answers.ts";
import { generateDiffQuestions } from "../src/server/diff-questions.ts";
import { evidencePassedLevels } from "../src/server/evidence.ts";
import { githubRepoClient } from "../src/server/github-repo.ts";
import { createInngest } from "../src/server/ladder-generate.ts";
import { migrateDown, migrateUp } from "../src/server/migrate.ts";
import { createModelA, type ModelADeps } from "../src/server/model-a.ts";
import { levelLockState } from "../src/shared/levels.ts";
import { createTestDatabase } from "./support/db.ts";
import { fixtureFetch, rateLimited } from "./support/github-fixtures.ts";
import { seedLadder } from "./support/mcq-seed.ts";
import {
  BASE_SHA,
  DIFF_FILES,
  diffFixture,
  EXTRA,
  GOOD,
  HEAD_SHA,
  HEAD_SHA_2,
  invalidOutput,
  KEYS,
  knows,
  LOCK_ONLY_FILES,
  mockModelB,
  q,
  REPO,
  scriptedModelA,
  wrong,
} from "./support/t014-diff.ts";

let db: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => {
  db = await createTestDatabase();
  await migrateUp(db.sql);
});
afterAll(async () => {
  await db.drop();
});
beforeEach(async () => {
  await db.sql`TRUNCATE diff_question_sets, artifacts, evidence_records, review_cards, ladders, repo_snapshots, users CASCADE`;
});

const NOW = new Date("2026-11-24T09:00:00Z");
let nextGithubId = 9000;

type World = { userId: string; login: string; ladderId: string; artifactId: string };
/** A learner, a ladder pinned at BASE_SHA, one L2 review card and a verified L2 artifact (as T013 stores it). */
async function world(head = HEAD_SHA, existing?: Omit<World, "artifactId">): Promise<World> {
  let base = existing;
  if (!base) {
    const login = `learner${nextGithubId}`;
    const [u] = await db.sql`
      INSERT INTO users (github_id, github_login) VALUES (${nextGithubId++}, ${login}) RETURNING id::text AS id`;
    const ladder = await seedLadder(db.sql);
    await db.sql`UPDATE ladders SET commit_sha = ${BASE_SHA} WHERE id = ${ladder.ladderId}`;
    await db.sql`INSERT INTO review_cards (ladder_id, level, front, back) VALUES (${ladder.ladderId}, 'L2', 'f', 'b')`;
    base = { userId: u.id, login, ladderId: ladder.ladderId };
  }
  const [a] = await db.sql`
    INSERT INTO artifacts (learner_id, ladder_id, level, kind, url, repo_full_name, head_sha, verified_at)
    VALUES (${base.userId}, ${base.ladderId}, 'L2', 'branch', ${`https://github.com/${REPO}/tree/feature/retry`},
      ${REPO}, ${head}, ${NOW}) RETURNING id::text AS id`;
  return { ...base, artifactId: a.id };
}

const l2Event = (w: World, head = HEAD_SHA) => ({
  name: L2_ARTIFACT_EVENT,
  data: {
    artifactId: w.artifactId,
    learnerId: w.userId,
    ladderId: w.ladderId,
    repo: REPO,
    baseSha: BASE_SHA,
    headSha: head,
  },
});

function engine(
  event: { name: string; data: Record<string, unknown> },
  opts: { modelA: ModelADeps; modelB: ModelADeps; files?: unknown[]; head?: string; override?: () => Response },
) {
  const fx = fixtureFetch([diffFixture(opts.files, opts.head)], opts.override);
  const github = githubRepoClient({ baseUrl: "https://api.github.com", token: "app-token", fetch: fx.impl });
  const deps = { sql: db.sql, github, modelA: opts.modelA, modelB: opts.modelB, dedupeJaccard: 0.8, now: () => NOW };
  const fn = generateDiffQuestions(createInngest(), deps);
  return { t: new InngestTestEngine({ function: fn, events: [event as never] }), fx };
}
const apiModelB = (b: ReturnType<typeof mockModelB>): ModelADeps => createModelA({ backend: "api", model: b.model });

const sets = async (artifactId: string) =>
  await db.sql`SELECT id::text AS id, attempt, status, reason FROM diff_question_sets WHERE artifact_id = ${artifactId} ORDER BY attempt`;
const storedQuestions = async (setId: string) =>
  await db.sql`SELECT id::text AS id, question, options, key, hunk_id FROM diff_questions WHERE set_id = ${setId} ORDER BY position`;

/** Answers `right` questions with the key and the rest wrong (from the client view: indexes into shown options). */
async function answersFor(setId: string, right: number): Promise<Record<string, number>> {
  const rows = await storedQuestions(setId);
  return Object.fromEntries(
    rows.map((r: { id: string; options: string[]; key: string }, i: number) => [
      r.id,
      i < right ? r.options.indexOf(r.key) : r.options.findIndex((o) => o !== r.key),
    ]),
  );
}

/** Runs the workflow to a ready set of GOOD questions; returns the set id. */
async function readySet(w: World, head = HEAD_SHA): Promise<string> {
  const a = scriptedModelA([GOOD]);
  const { t } = engine(l2Event(w, head), { modelA: a.modelA, modelB: apiModelB(mockModelB(knows)), head });
  const { result } = await t.execute();
  expect(result).toMatchObject({ status: "ready" });
  return (await sets(w.artifactId)).at(-1).id;
}

describe("T014 generateDiffQuestions (AC 1-4)", () => {
  test("SC 1: 3-hunk diff, 5 valid questions, B agrees -> 5 stored; the status view never carries a key", async () => {
    const w = await world();
    const a = scriptedModelA([GOOD]);
    const b = mockModelB(knows);
    const { t, fx } = engine(l2Event(w), { modelA: a.modelA, modelB: apiModelB(b) });
    const { result, ctx } = await t.execute();
    expect(result).toMatchObject({ status: "ready" });
    // AC 1: the diff is read at the stored range pinned SHA...headSha, never the branch tip
    expect(fx.calls).toEqual([`/repos/${REPO}/compare/${BASE_SHA}...${HEAD_SHA}?per_page=1&page=1`]);
    // AC 1: one step per stage
    const steps = ctx.step.run.mock.calls.map((c) => c[0]);
    expect(steps).toEqual(["open-set", "fetch-diff", "generate-0", "code-check-0", "blind-solve-0", "save"]);
    // AC 2: model A got only the 3 diff hunks (lockfile and binary filtered out)
    const data = JSON.parse(a.prompts[0]?.split("\n")[1] ?? "{}");
    expect(data.hunks.map((h: { id: string }) => h.id)).toEqual([
      "src/retry.ts#0",
      "src/retry.ts#1",
      "src/config.ts#0",
    ]);
    expect(a.prompts[0]).not.toContain("bun.lock");
    // AC 3: model B saw question + options + hunk text, never the key field or the hunk id
    expect(b.seen).toHaveLength(5);
    for (const s of b.seen) {
      expect(s.raw).not.toContain("citedHunkId");
      expect(s.raw).not.toContain("src/retry.ts#");
      expect(s.raw).not.toContain("src/config.ts#");
      expect(s.raw).not.toContain('"key"');
    }
    const [set] = await sets(w.artifactId);
    const rows = await storedQuestions(set.id);
    expect(rows).toHaveLength(5);
    expect(rows.map((r: { key: string }) => r.key).sort()).toEqual(GOOD.map((m) => m.key).sort());
    const view = await diffQuestionStatus(db.sql, w.userId, w.artifactId);
    expect(view).toMatchObject({ status: "ready", setId: set.id });
    expect(view?.questions).toHaveLength(5);
    const text = JSON.stringify(view);
    expect(text).not.toContain('"key"');
    expect(text).not.toContain("hunk");
    for (const qn of view?.questions ?? []) expect(Object.keys(qn).sort()).toEqual(["id", "options", "question"]);
  });

  test("SC 2: a question citing a hunk not in the diff and one B disagreement -> 2 discarded, 1 regenerate round, 5 stored", async () => {
    const w = await world();
    const bad = q("Which file did you rename?", "x", "src/other.ts#0", ["y", "z", "w"]);
    const a = scriptedModelA([[GOOD[0], GOOD[1], GOOD[2], GOOD[3], bad] as never, [GOOD[4], EXTRA[0]] as never]);
    const disagreeOn = GOOD[3]?.question;
    const b = mockModelB((d) => (d.question === disagreeOn ? wrong(d) : knows(d)));
    const { t } = engine(l2Event(w), { modelA: a.modelA, modelB: apiModelB(b) });
    const run = await t.execute();
    expect(run.result).toMatchObject({ status: "ready" });
    expect(a.calls()).toBe(2);
    expect(JSON.parse(a.prompts[1]?.split("\n")[1] ?? "{}").count).toBe(2);
    const steps = run.ctx.step.run.mock.calls.map((c) => c[0]);
    expect(steps).toContain("generate-1");
    expect(steps).not.toContain("generate-2");
    const [set] = await sets(w.artifactId);
    const stored = (await storedQuestions(set.id)).map((r: { question: string }) => r.question);
    expect(stored).toHaveLength(5);
    expect(stored).not.toContain(bad.question);
    expect(stored).not.toContain(disagreeOn);
  });

  test("SC 3: B disagrees on every question in all rounds -> diff-questions-unavailable after 2 regenerate rounds, 0 served", async () => {
    const w = await world();
    const a = scriptedModelA([GOOD, EXTRA, [...EXTRA].reverse()]);
    const { t } = engine(l2Event(w), { modelA: a.modelA, modelB: apiModelB(mockModelB(wrong)) });
    const { result } = await t.execute();
    expect(result).toMatchObject({ status: "diff-questions-unavailable", reason: "too-few-verified" });
    expect(a.calls()).toBe(3); // the first round + 2 regenerate rounds
    const [set] = await sets(w.artifactId);
    expect(set).toMatchObject({ status: "diff-questions-unavailable", reason: "too-few-verified" });
    expect(await storedQuestions(set.id)).toHaveLength(0);
    const view = await diffQuestionStatus(db.sql, w.userId, w.artifactId);
    expect(view).toEqual({ status: "diff-questions-unavailable", reason: "too-few-verified", setId: set.id });
    // L2 stays open: no evidence record
    expect(levelLockState(await evidencePassedLevels(db.sql)(w.ladderId, w.userId))[2]).not.toBe("passed");
  });

  test("SC 4: the blind-solve step throws once, then succeeds -> model A called once in total", async () => {
    const w = await world();
    const a = scriptedModelA([GOOD]);
    let calls = 0;
    const b = mockModelB((d) => (calls++ === 0 ? new Error("socket hang up (not a model answer)") : knows(d)));
    const { t } = engine(l2Event(w), { modelA: a.modelA, modelB: apiModelB(b) });
    const first = await t.execute();
    const ran = first.ctx.step.run.mock.calls.map((c) => c[0] as string);
    expect(ran.at(-1)).toBe("blind-solve-0");
    expect(first.error).toBeDefined();
    // Inngest retries only the failed step: earlier steps replay from their memoized results.
    const results = first.ctx.step.run.mock.results;
    const memo = await Promise.all(
      ran.slice(0, -1).map(async (id, i) => {
        const value = await (results[i] as { value?: unknown }).value;
        return { id, handler: async () => value };
      }),
    );
    const retry = await t.execute({ steps: memo });
    expect(retry.result).toMatchObject({ status: "ready" });
    expect(a.calls()).toBe(1);
    expect(await storedQuestions((await sets(w.artifactId))[0].id)).toHaveLength(5);
  });

  test("SC 4 (provider): a retryable APICallError from model B once -> the run ends ready, model A called once", async () => {
    const w = await world();
    const a = scriptedModelA([GOOD]);
    let calls = 0;
    const overloaded = () =>
      new APICallError({
        message: "Overloaded",
        url: "https://api.anthropic.com/v1/messages",
        requestBodyValues: {},
        statusCode: 529,
        isRetryable: true,
      });
    const b = mockModelB((d) => (calls++ === 0 ? overloaded() : knows(d)));
    const { t } = engine(l2Event(w), { modelA: a.modelA, modelB: apiModelB(b) });
    const { result } = await t.execute();
    expect(result).toMatchObject({ status: "ready" });
    expect(a.calls()).toBe(1);
    expect(b.seen).toHaveLength(6); // 5 questions + 1 retried call
    expect(await storedQuestions((await sets(w.artifactId))[0].id)).toHaveLength(5);
  }, 20_000);

  test("P2: model A sees each hunk cut to BLIND_CHUNK_CHARS; a key only after the cut fails the code check", async () => {
    const w = await world();
    const filler = Array.from({ length: 120 }, (_, i) => `+// filler line number ${i}`).join("\n");
    const patch = `@@ -1,1 +1,121 @@\n${filler}\n+export const lateConstant = 7;`;
    expect(patch.indexOf("lateConstant")).toBeGreaterThan(BLIND_CHUNK_CHARS);
    const late = q("Which constant did you add at the end?", "lateConstant", "src/big.ts#0", ["early", "mid", "none"]);
    const a = scriptedModelA([[late] as never]);
    const b = mockModelB(knows);
    const files = [{ filename: "src/big.ts", status: "modified", patch }];
    const { t } = engine(l2Event(w), { modelA: a.modelA, modelB: apiModelB(b), files });
    const { result } = await t.execute();
    expect(result).toMatchObject({ status: "diff-questions-unavailable", reason: "too-few-verified" });
    const hunk = JSON.parse(a.prompts[0]?.split("\n")[1] ?? "{}").hunks[0];
    expect(hunk.text).toHaveLength(BLIND_CHUNK_CHARS);
    expect(hunk.text).not.toContain("lateConstant");
    expect(b.seen).toHaveLength(0); // rejected by the code check, never blind-solved
  });

  test("SC 6: a diff that changes only bun.lock -> diff-not-testable before any LLM call", async () => {
    const w = await world();
    const a = scriptedModelA([GOOD]);
    const b = mockModelB(knows);
    const { t } = engine(l2Event(w), { modelA: a.modelA, modelB: apiModelB(b), files: LOCK_ONLY_FILES });
    const { result } = await t.execute();
    expect(result).toMatchObject({ status: "diff-not-testable", reason: "no-code-change" });
    expect(a.calls()).toBe(0);
    expect(b.seen).toHaveLength(0);
  });

  test("edge: GitHub no longer has headSha (force-push + GC) -> diff-not-testable `sha-gone`", async () => {
    const w = await world();
    const a = scriptedModelA([GOOD]);
    const { t } = engine(l2Event(w), {
      modelA: a.modelA,
      modelB: apiModelB(mockModelB(knows)),
      files: [],
      head: "9".repeat(40),
    });
    const { result } = await t.execute();
    expect(result).toMatchObject({ status: "diff-not-testable", reason: "sha-gone" });
    expect(a.calls()).toBe(0);
  });

  test("edge: GitHub rate limit while fetching the diff -> the step retries at the reset time; no set served", async () => {
    const w = await world();
    const reset = Math.floor(NOW.getTime() / 1000) + 600;
    const a = scriptedModelA([GOOD]);
    const { t } = engine(l2Event(w), {
      modelA: a.modelA,
      modelB: apiModelB(mockModelB(knows)),
      override: () => rateLimited(reset),
    });
    const { error } = await t.execute();
    expect(String((error as { name?: string })?.name ?? error)).toContain("RetryAfterError");
    expect(a.calls()).toBe(0);
    expect((await sets(w.artifactId))[0]).toMatchObject({ status: "generating" });
    expect(await diffQuestionStatus(db.sql, w.userId, w.artifactId)).toEqual({
      status: "generating",
      setId: expect.any(String),
    });
  });

  test("edge: code check rejects substring keys, duplicate options, > 500 chars; invalid model output spends a round", async () => {
    const w = await world();
    const substring = q("Which word appears in maxAttempts?", "Attempt", "src/retry.ts#0", ["a", "b", "c"]);
    const dupOptions = q("Which constant is new?", "delayMs", "src/retry.ts#0", ["DelayMs ", "x", "y"]);
    const long = q(`${"Long ".repeat(101)}?`, "250", "src/retry.ts#0", ["1", "2", "3"]);
    const a = scriptedModelA([
      [substring, dupOptions, long, GOOD[0], GOOD[1]] as never,
      invalidOutput(),
      GOOD.slice(2),
    ]);
    const { t } = engine(l2Event(w), { modelA: a.modelA, modelB: apiModelB(mockModelB(knows)) });
    const { result } = await t.execute();
    expect(result).toMatchObject({ status: "ready" });
    expect(a.calls()).toBe(3);
    const stored = (await storedQuestions((await sets(w.artifactId))[0].id)).map((r: { key: string }) => r.key);
    expect(stored.sort()).toEqual(GOOD.map((m) => m.key).sort());
  });

  test("edge: the same L2 artifact event delivered twice -> one question set, no second LLM call", async () => {
    const w = await world();
    await readySet(w);
    const a = scriptedModelA([EXTRA]);
    const { t } = engine(l2Event(w), { modelA: a.modelA, modelB: apiModelB(mockModelB(knows)) });
    const { result } = await t.execute();
    expect(result).toMatchObject({ status: "ready" });
    expect(a.calls()).toBe(0);
    expect(await sets(w.artifactId)).toHaveLength(1);
  });
});

describe("T014 submitDiffAnswers (AC 5, 6)", () => {
  test("SC 5: 4 of 5 -> pass, evidence {asked 5, correct 4, pass 4}, L3 unlocked; a separate set 3 of 5 -> fail, no record", async () => {
    const w = await world();
    const setId = await readySet(w);
    const passed = await submitDiffAnswers(db.sql, w.userId, setId, await answersFor(setId, 4), NOW);
    expect(passed).toMatchObject({ attemptId: setId, asked: 5, correct: 4, pass: true, unlockedLevel: "L3" });
    const evidence = (passed as { evidence: Record<string, unknown> }).evidence;
    expect(evidence).toMatchObject({
      learner: `github:${w.login}`,
      level: "L2",
      test: "artifact+diff-questions",
      evidence: {
        branch: `https://github.com/${REPO}/tree/feature/retry`,
        commit: HEAD_SHA,
        diffQuestions: { asked: 5, correct: 4, pass: DIFF_PASS_MIN },
      },
    });
    expect(String(evidence.hash)).toMatch(/^sha256:[0-9a-f]{64}$/);
    // The record is the unlock: with L0 and L1 passed earlier (T012), L2 now reads passed and L3 open.
    const passedNow = await evidencePassedLevels(db.sql)(w.ladderId, w.userId);
    expect(passedNow).toEqual(["L2"]);
    const lock = levelLockState(["L0", "L1", ...passedNow]);
    expect(lock[2]).toBe("passed");
    expect(lock[3]).toBe("open");
    expect(await diffQuestionStatus(db.sql, w.userId, w.artifactId)).toEqual({ status: "passed", setId });

    const other = await world(HEAD_SHA_2);
    const failSet = await readySet(other, HEAD_SHA_2);
    const failed = await submitDiffAnswers(db.sql, other.userId, failSet, await answersFor(failSet, 3), NOW);
    expect(failed).toMatchObject({ asked: 5, correct: 3, pass: false, unlockedLevel: null, evidence: null });
    const [card] = await db.sql`SELECT id::text AS id FROM review_cards WHERE ladder_id = ${other.ladderId}`;
    expect((failed as { reviewCardIds: string[] }).reviewCardIds).toEqual([card.id]);
    const records = await db.sql`SELECT 1 FROM evidence_records WHERE learner_id = ${other.userId}`;
    expect(records).toHaveLength(0);
    expect(await diffQuestionStatus(db.sql, other.userId, other.artifactId)).toEqual({
      status: "failed",
      setId: failSet,
    });
  });

  test("scoring arithmetic: 5/5 and 4/5 pass; 3/5 and 0/5 fail", async () => {
    for (const [right, pass] of [
      [5, true],
      [4, true],
      [3, false],
      [0, false],
    ] as const) {
      const w = await world();
      const setId = await readySet(w);
      const r = await submitDiffAnswers(db.sql, w.userId, setId, await answersFor(setId, right), NOW);
      expect(r).toMatchObject({ correct: right, pass });
    }
  });

  test("AC 6: another learner's set, a second submit, unknown question ids -> rejected, nothing stored", async () => {
    const w = await world();
    const setId = await readySet(w);
    const intruder = await world(HEAD_SHA_2);
    const answers = await answersFor(setId, 5);
    expect(await submitDiffAnswers(db.sql, intruder.userId, setId, answers, NOW)).toEqual({
      status: 404,
      error: "not-found",
    });
    expect(await submitDiffAnswers(db.sql, w.userId, setId, { ...answers, "999999": 0 }, NOW)).toEqual({
      status: 422,
      error: "unknown-question",
    });
    expect(await submitDiffAnswers(db.sql, w.userId, setId, { a: 7 }, NOW)).toEqual({
      status: 400,
      error: "invalid-request",
    });
    expect((await sets(w.artifactId))[0]).toMatchObject({ status: "ready" });
    expect(await db.sql`SELECT 1 FROM evidence_records`).toHaveLength(0);
    expect(await submitDiffAnswers(db.sql, w.userId, setId, answers, NOW)).toMatchObject({ pass: true });
    expect(await submitDiffAnswers(db.sql, w.userId, setId, answers, NOW)).toEqual({
      status: 409,
      error: "already-submitted",
    });
    expect(await db.sql`SELECT 1 FROM evidence_records`).toHaveLength(1);
  });

  test("AC 6: a retake gets a newly generated set with no question shown before; T012's rate limit (3 per 24 h)", async () => {
    const w = await world();
    const first = await readySet(w);
    const events: DiffRetakeEvent[] = [];
    const emit = async (e: DiffRetakeEvent) => {
      events.push(e);
    };
    // a retake is only for a failed set
    expect(await retakeDiffQuestions(db.sql, w.userId, w.artifactId, NOW, emit)).toEqual({
      status: 409,
      error: "retake-not-allowed",
    });
    await submitDiffAnswers(db.sql, w.userId, first, await answersFor(first, 2), NOW);
    const retake = await retakeDiffQuestions(db.sql, w.userId, w.artifactId, NOW, emit);
    expect(retake).toEqual({ status: "generating", setId: expect.any(String) });
    expect(events).toEqual([
      {
        id: `diff-retake-${(retake as { setId: string }).setId}`,
        name: DIFF_RETAKE_EVENT,
        data: { setId: (retake as { setId: string }).setId, artifactId: w.artifactId },
      },
    ]);
    // model A first repeats the earlier 5 (all discarded as reused), then writes new ones
    const a = scriptedModelA([GOOD, EXTRA]);
    const { t } = engine(events[0] as never, { modelA: a.modelA, modelB: apiModelB(mockModelB(knows)) });
    expect((await t.execute()).result).toMatchObject({ status: "ready" });
    const [s1, s2] = await sets(w.artifactId);
    expect(s2).toMatchObject({ attempt: 2, status: "ready" });
    const before = (await storedQuestions(s1.id)).map((r: { question: string }) => r.question);
    const after = (await storedQuestions(s2.id)).map((r: { question: string }) => r.question);
    expect(after).toHaveLength(5);
    expect(after.filter((x: string) => before.includes(x))).toEqual([]);

    // third attempt in 24 h is allowed; the fourth is refused with retryAt
    await submitDiffAnswers(db.sql, w.userId, s2.id, await answersFor(s2.id, 0), NOW);
    expect(await retakeDiffQuestions(db.sql, w.userId, w.artifactId, NOW, emit)).toMatchObject({
      status: "generating",
    });
    await db.sql`UPDATE diff_question_sets SET status = 'failed', correct = 0, submitted_at = ${NOW} WHERE artifact_id = ${w.artifactId} AND attempt = 3`;
    expect(await retakeDiffQuestions(db.sql, w.userId, w.artifactId, NOW, emit)).toEqual({
      status: 429,
      error: "too-many-attempts",
      retryAt: new Date(NOW.getTime() + 86_400_000).toISOString(),
    });
    // a new branch in the same 24 h is an attempt too: refused before any LLM call
    const next = await world(HEAD_SHA_2, w);
    const a2 = scriptedModelA([GOOD]);
    const { t: t2 } = engine(l2Event(next, HEAD_SHA_2), {
      modelA: a2.modelA,
      modelB: apiModelB(mockModelB(knows)),
      head: HEAD_SHA_2,
    });
    expect((await t2.execute()).result).toMatchObject({
      status: "diff-questions-unavailable",
      reason: "too-many-attempts",
    });
    expect(a2.calls()).toBe(0);
  });
});

/** A set row in a given state, created at NOW (the attempt-limit window). */
async function seedSet(artifactId: string, attempt: number, status: string, reason: string | null = null) {
  const done = status === "passed" || status === "failed";
  await db.sql`
    INSERT INTO diff_question_sets (artifact_id, attempt, status, reason, created_at, submitted_at, correct)
    VALUES (${artifactId}, ${attempt}, ${status}, ${reason}, ${NOW}, ${done ? NOW : null}, ${done ? 0 : null})`;
}
const noEmit = async () => {};

/** The app with a session for the learner of `w`; retake events go to `retakes`. */
async function routeApp(w: World, retakes: DiffRetakeEvent[] = []) {
  const config = loadConfig({
    DATABASE_URL: db.url,
    GITHUB_CLIENT_ID: "id",
    GITHUB_CLIENT_SECRET: "secret",
    GITHUB_APP_TOKEN: "token",
    SESSION_SECRET: "x".repeat(48),
    ANTHROPIC_API_KEY: "sk-ant-test",
    MODEL_A_ID: "test-model",
    NODE_ENV: "test",
  });
  const app = createApp({
    config,
    sql: db.sql,
    clientDir: "tests/fixtures/client",
    emitDiffRetake: async (e) => {
      retakes.push(e);
    },
  });
  const [u] = await db.sql`SELECT github_id FROM users WHERE id = ${w.userId}`;
  const cookie = `il_session=${await signInUser(db.sql, "x".repeat(48), { id: Number(u.github_id), login: w.login })}`;
  const post = (path: string) =>
    app.request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: "{}",
    });
  return { post };
}

describe("T014 retake after a system failure (Stage 4 P1)", () => {
  test("(a) a retake after `queue-unavailable` returns 202 and sends the retake event", async () => {
    const w = await world();
    await seedSet(w.artifactId, 1, "diff-questions-unavailable", "queue-unavailable");
    const retakes: DiffRetakeEvent[] = [];
    const { post } = await routeApp(w, retakes);
    const res = await post(`/api/artifacts/${w.artifactId}/diff-questions`);
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toEqual({ status: "generating", setId: expect.any(String) });
    expect(retakes.map((e) => e.data)).toEqual([{ setId: body.setId, artifactId: w.artifactId }]);
    expect((await sets(w.artifactId)).at(-1)).toMatchObject({ attempt: 2, status: "generating" });
  });

  test("(b) a retake after `generation-failed` and after `too-few-verified` is allowed", async () => {
    for (const reason of ["generation-failed", "too-few-verified"]) {
      const w = await world();
      await seedSet(w.artifactId, 1, "diff-questions-unavailable", reason);
      expect(await retakeDiffQuestions(db.sql, w.userId, w.artifactId, NOW, noEmit)).toEqual({
        status: "generating",
        setId: expect.any(String),
      });
    }
  });

  test("(c) 409 retake-not-allowed stays for generating, ready, passed, diff-not-testable and too-many-attempts", async () => {
    const states: [string, string | null][] = [
      ["generating", null],
      ["ready", null],
      ["passed", null],
      ["diff-not-testable", "no-code-change"],
      ["diff-not-testable", "sha-gone"],
      ["diff-questions-unavailable", "too-many-attempts"],
    ];
    for (const [status, reason] of states) {
      const w = await world();
      await seedSet(w.artifactId, 1, status, reason);
      expect(await retakeDiffQuestions(db.sql, w.userId, w.artifactId, NOW, noEmit)).toEqual({
        status: 409,
        error: "retake-not-allowed",
      });
      expect(await sets(w.artifactId)).toHaveLength(1);
    }
  });

  test("(d) queue-unavailable and generation-failed sets are not counted toward 3 per 24 h; too-few-verified is", async () => {
    const w = await world();
    await seedSet(w.artifactId, 1, "diff-questions-unavailable", "queue-unavailable");
    await seedSet(w.artifactId, 2, "diff-questions-unavailable", "generation-failed");
    await seedSet(w.artifactId, 3, "diff-questions-unavailable", "too-few-verified");
    await seedSet(w.artifactId, 4, "failed");
    // counted: attempts 3 and 4 only (2 < 3), so this retake is allowed
    expect(await retakeDiffQuestions(db.sql, w.userId, w.artifactId, NOW, noEmit)).toMatchObject({
      status: "generating",
    });
    await db.sql`UPDATE diff_question_sets SET status = 'failed', correct = 0, submitted_at = ${NOW} WHERE artifact_id = ${w.artifactId} AND attempt = 5`;
    // counted now: 3, 4 and 5 -> the limit holds (too-few-verified counts as an attempt)
    expect(await retakeDiffQuestions(db.sql, w.userId, w.artifactId, NOW, noEmit)).toMatchObject({
      status: 429,
      error: "too-many-attempts",
    });
  });
});

describe("T014 no LLM in scoring (AC 7, NFR-002)", () => {
  test("submitDiffAnswers imports no model module and calls nothing over the network", async () => {
    const transpiler = new Bun.Transpiler({ loader: "ts" });
    const seen = new Set<string>();
    const packages = new Set<string>();
    const queue = [resolve("src/server/diff-answers.ts")];
    while (queue.length) {
      const file = queue.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      if (!file.endsWith(".ts")) continue;
      for (const imp of transpiler.scanImports(await Bun.file(file).text())) {
        if (imp.path.startsWith(".")) queue.push(resolve(dirname(file), imp.path));
        else packages.add(imp.path);
      }
    }
    const names = [...seen].map((f) => f.split("/").at(-1));
    for (const m of ["model-a.ts", "blind-solver.ts", "diff-questions.ts", "claude-code-reader.ts", "repo-reader.ts"])
      expect(names).not.toContain(m);
    for (const p of packages) expect(p.startsWith("ai") || p.startsWith("@ai-sdk")).toBe(false);

    const w = await world();
    const setId = await readySet(w);
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((() => {
      throw new Error("no network call is allowed in scoring");
    }) as never);
    try {
      expect(await submitDiffAnswers(db.sql, w.userId, setId, await answersFor(setId, 5), NOW)).toMatchObject({
        pass: true,
      });
    } finally {
      fetchSpy.mockRestore();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("T014 routes (T030 contract)", () => {
  test("GET /api/artifacts/:id/diff-questions and POST /api/diff-question-sets/:id/submit; 401, 404, no-store", async () => {
    const config = loadConfig({
      DATABASE_URL: db.url,
      GITHUB_CLIENT_ID: "id",
      GITHUB_CLIENT_SECRET: "secret",
      GITHUB_APP_TOKEN: "token",
      SESSION_SECRET: "x".repeat(48),
      ANTHROPIC_API_KEY: "sk-ant-test",
      MODEL_A_ID: "test-model",
      NODE_ENV: "test",
    });
    const retakes: DiffRetakeEvent[] = [];
    const app = createApp({
      config,
      sql: db.sql,
      clientDir: "tests/fixtures/client",
      emitDiffRetake: async (e) => {
        retakes.push(e);
      },
    });
    const w = await world();
    const [u] = await db.sql`SELECT github_id FROM users WHERE id = ${w.userId}`;
    const cookie = `il_session=${await signInUser(db.sql, "x".repeat(48), { id: Number(u.github_id), login: w.login })}`;
    const get = (path: string, c?: string) =>
      app.request(`http://localhost${path}`, c ? { headers: { cookie: c } } : {});
    const post = (path: string, body: unknown, c?: string) =>
      app.request(`http://localhost${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(c ? { cookie: c } : {}) },
        body: JSON.stringify(body),
      });

    expect((await get(`/api/artifacts/${w.artifactId}/diff-questions`)).status).toBe(401);
    const waiting = await get(`/api/artifacts/${w.artifactId}/diff-questions`, cookie);
    expect(waiting.headers.get("cache-control")).toBe("no-store");
    expect(await waiting.json()).toEqual({ status: "generating" });
    expect((await get("/api/artifacts/424242/diff-questions", cookie)).status).toBe(404);

    const setId = await readySet(w);
    const ready = await (await get(`/api/artifacts/${w.artifactId}/diff-questions`, cookie)).json();
    expect(ready).toMatchObject({ status: "ready", setId });
    expect(JSON.stringify(ready)).not.toContain('"key"');
    const answers = Object.fromEntries(
      ready.questions.map((x: { id: string; question: string; options: string[] }) => [
        x.id,
        x.options.indexOf(KEYS.get(x.question) as string),
      ]),
    );
    expect((await post(`/api/diff-question-sets/${setId}/submit`, { answers })).status).toBe(401);
    const res = await post(`/api/diff-question-sets/${setId}/submit`, { answers }, cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ attemptId: setId, asked: 5, correct: 5, pass: true, unlockedLevel: "L3" });
    const again = await post(`/api/diff-question-sets/${setId}/submit`, { answers }, cookie);
    expect(again.status).toBe(409);
    expect((await post(`/api/artifacts/${w.artifactId}/diff-questions`, {}, cookie)).status).toBe(409);
    expect(retakes).toHaveLength(0);
  });
});

describe("T014 migration 0015_diff_questions", () => {
  test("constraints hold; down drops only the two tables with rows present; up again restores them", async () => {
    const w = await world();
    const setId = await readySet(w);
    const reject = async (p: Promise<unknown>) => expect(p).rejects.toThrow();
    await reject(
      db.sql`INSERT INTO diff_question_sets (artifact_id, attempt, status, created_at) VALUES (${w.artifactId}, 1, 'ready', now())`,
    );
    await reject(
      db.sql`INSERT INTO diff_question_sets (artifact_id, attempt, status, created_at) VALUES (${w.artifactId}, 9, 'done', now())`,
    );
    await reject(
      db.sql`INSERT INTO diff_question_sets (artifact_id, attempt, status, created_at) VALUES (${w.artifactId}, 9, 'passed', now())`,
    );
    await reject(
      db.sql`INSERT INTO diff_questions (set_id, position, question, options, key, hunk_id) VALUES (${setId}, 5, 'q', '["a","b","c","d"]'::jsonb, 'a', 'f#0')`,
    );
    await reject(
      db.sql`INSERT INTO diff_questions (set_id, position, question, options, key, hunk_id) VALUES (${setId}, 0, 'q', '["a","b","c","d"]'::jsonb, 'a', 'f#0')`,
    );
    const ALLOW_DOWN = { MIGRATE_ALLOW_DOWN: "1" };
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0015_diff_questions");
    const left =
      await db.sql`SELECT to_regclass('public.diff_question_sets') AS s, to_regclass('public.diff_questions') AS q,
      to_regclass('public.artifacts') AS a`;
    expect(left).toEqual([{ s: null, q: null, a: "artifacts" }]);
    expect(await db.sql`SELECT 1 FROM artifacts WHERE id = ${w.artifactId}`).toHaveLength(1);
    expect(await migrateUp(db.sql)).toEqual(["0015_diff_questions"]);
    void DIFF_FILES;
  });
});
