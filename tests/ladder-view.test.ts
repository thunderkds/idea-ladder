import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { getLadderView, listLadders } from "../src/server/ladder-view.ts";
import { V0_REPOS } from "./support/github-fixtures.ts";
import { startHarness } from "./support/start-harness.ts";

const SHA: string = V0_REPOS["developit/mitt"];
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

async function seedLadder(repo = "developit/mitt", sha = SHA, status = "unverified"): Promise<string> {
  const [row] =
    await sql()`INSERT INTO ladders (repo_full_name, commit_sha, status) VALUES (${repo}, ${sha}, ${status}) RETURNING id::text AS id`;
  return row.id;
}
async function seedLevel(ladderId: string, level: string, extra: { goal?: string; skip?: string } = {}) {
  await sql()`INSERT INTO ladder_levels (ladder_id, level, title, goal, pass_test_kind, pass_test_description, skip_reason)
    VALUES (${ladderId}, ${level}, ${`Title ${level}`}, ${extra.goal ?? `Goal ${level}`}, ${`kind-${level}`}, ${`Pass ${level}`}, ${extra.skip ?? null})`;
}
async function seedFiveLevels(ladderId: string) {
  for (const l of ["L0", "L1", "L2", "L3", "L4"]) await seedLevel(ladderId, l);
}

describe("getLadderView (AC 1, Success Criteria 7)", () => {
  test("a ladder with five level rows: repo, SHA, status and the stored level text, L0 open", async () => {
    const id = await seedLadder();
    await seedFiveLevels(id);
    const view = await getLadderView(sql(), id, "1");
    expect(view?.repoFullName).toBe("developit/mitt");
    expect(view?.commitSha).toBe(SHA);
    expect(view?.status).toBe("unverified");
    expect(view?.levels.map((l) => l.id)).toEqual(["L0", "L1", "L2", "L3", "L4"]);
    expect(view?.levels[2]).toEqual({
      id: "L2",
      title: "Title L2",
      goal: "Goal L2",
      passTest: { kind: "kind-L2", description: "Pass L2" },
      lock: "locked",
    });
    expect(view?.levels.map((l) => l.lock)).toEqual(["open", "locked", "locked", "locked", "locked"]);
  });

  test("a ladder with no level rows: fixed titles and pass tests, goal `Not generated yet`", async () => {
    const id = await seedLadder();
    const view = await getLadderView(sql(), id, "1");
    expect(view?.levels.map((l) => l.title)).toEqual([
      "Prerequisites",
      "Run it",
      "Modify",
      "Understand",
      "Rebuild or contribute",
    ]);
    expect(view?.levels.map((l) => l.goal)).toEqual(Array(5).fill("Not generated yet"));
    expect(view?.levels[0]?.passTest).toEqual({ kind: "concept-ladder-tests", description: "Concept ladder tests" });
    expect(view?.levels[4]?.passTest.description).toBe("Repo link or PR link");
  });

  test("some level rows only: rows are used, missing levels fall back", async () => {
    const id = await seedLadder();
    await seedLevel(id, "L0");
    const view = await getLadderView(sql(), id, "1");
    expect(view?.levels[0]?.goal).toBe("Goal L0");
    expect(view?.levels[1]?.goal).toBe("Not generated yet");
    expect(view?.levels[1]?.title).toBe("Run it");
  });

  test("a concept-only-skipped level says so", async () => {
    const id = await seedLadder();
    await seedLevel(id, "L1", { skip: "concept-only-skipped", goal: "" });
    const view = await getLadderView(sql(), id, "1");
    expect(view?.levels[1]?.goal).toBe("Concept-only ladder: this level is not generated for this repo");
  });

  test("lock state is the learner's own: B sees the same levels with B's passes", async () => {
    const id = await seedLadder();
    await seedFiveLevels(id);
    const passes = async (_l: string, userId: string) => (userId === "A" ? ["L0", "L1"] : []);
    const a = await getLadderView(sql(), id, "A", passes);
    const b = await getLadderView(sql(), id, "B", passes);
    expect(a?.levels.map((l) => l.lock)).toEqual(["passed", "passed", "open", "locked", "locked"]);
    expect(b?.levels.map((l) => l.lock)).toEqual(["open", "locked", "locked", "locked", "locked"]);
    expect(a?.levels.map((l) => l.goal)).toEqual(b?.levels.map((l) => l.goal) ?? []);
  });

  test("unknown, non-numeric and out-of-range ids give undefined (never a SQL error)", async () => {
    await seedLadder();
    for (const id of ["9999", "does-not-exist", "1e3", "0", "-1", "99999999999999999999", "1 OR 1=1"]) {
      expect(await getLadderView(sql(), id, "1")).toBeUndefined();
    }
  });

  test("deleting a ladder deletes its level rows", async () => {
    const id = await seedLadder();
    await seedFiveLevels(id);
    await sql()`DELETE FROM ladders WHERE id = ${id}`;
    expect(Number((await sql()`SELECT count(*)::int AS n FROM ladder_levels`)[0].n)).toBe(0);
  });
});

describe("listLadders (AC 7)", () => {
  test("lists only ladders whose job the learner started; empty otherwise", async () => {
    const maxUserId = async () => (await sql()`SELECT max(id)::text AS id FROM users`)[0].id as string;
    await h.learner();
    const meId = await maxUserId();
    await h.learner();
    const otherId = await maxUserId();
    const ladder = await seedLadder();
    await seedLadder("lukeed/dset", "a".repeat(40));
    await sql()`INSERT INTO generation_jobs (repo_full_name, commit_sha, status, started_by) VALUES ('developit/mitt', ${SHA}, 'fetched', ${meId})`;
    expect(await listLadders(sql(), meId)).toEqual([{ ladderId: ladder, repo: "developit/mitt" }]);
    expect(await listLadders(sql(), otherId)).toEqual([]);
  });
});

describe("listLadders duplicates", () => {
  test("a failed and a fetched job for the same repo + SHA and learner list the ladder once", async () => {
    await h.learner();
    const [{ id: userId }] = await sql()`SELECT max(id)::text AS id FROM users`;
    const ladder = await seedLadder();
    await sql()`INSERT INTO generation_jobs (repo_full_name, commit_sha, status, reason, started_by) VALUES ('developit/mitt', ${SHA}, 'failed', 'rate-limited', ${userId})`;
    await sql()`INSERT INTO generation_jobs (repo_full_name, commit_sha, status, started_by) VALUES ('developit/mitt', ${SHA}, 'fetched', ${userId})`;
    expect(await listLadders(sql(), userId)).toEqual([{ ladderId: ladder, repo: "developit/mitt" }]);
  });
});

describe("HTTP (AC 6, signed-in gate, no-store)", () => {
  test("GET /api/ladders/:id: 401 signed out, 404 unknown, 200 with the view; always no-store", async () => {
    const id = await seedLadder();
    await seedFiveLevels(id);
    const cookie = await h.learner();
    const out = await h.get(`/api/ladders/${id}`);
    expect(out.status).toBe(401);
    expect(out.headers.get("cache-control")).toBe("no-store");
    const missing = await h.get("/api/ladders/does-not-exist", cookie);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("cache-control")).toBe("no-store");
    const ok = await h.get(`/api/ladders/${id}`, cookie);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    const body = (await ok.json()) as { repoFullName: string; status: string; levels: { lock: string }[] };
    expect(body.repoFullName).toBe("developit/mitt");
    expect(body.status).toBe("unverified");
    expect(body.levels.map((l) => l.lock)).toEqual(["open", "locked", "locked", "locked", "locked"]);
  });

  test("GET /api/ladders: 401 signed out; the learner's own saved ladders", async () => {
    const id = await seedLadder();
    expect((await h.get("/api/ladders")).status).toBe(401);
    const cookie = await h.learner();
    const empty = await h.get("/api/ladders", cookie);
    expect(empty.headers.get("cache-control")).toBe("no-store");
    expect(await empty.json()).toEqual([]);
    const [{ id: userId }] = await sql()`SELECT max(id)::text AS id FROM users`;
    await sql()`INSERT INTO generation_jobs (repo_full_name, commit_sha, status, started_by) VALUES ('developit/mitt', ${SHA}, 'fetched', ${userId})`;
    expect(await (await h.get("/api/ladders", cookie)).json()).toEqual([{ ladderId: id, repo: "developit/mitt" }]);
  });

  test("GET /ladders/:id: signed out -> sign-in with a return to the same ladder; unknown -> 404 page", async () => {
    const id = await seedLadder();
    const out = await h.get(`/ladders/${id}`);
    expect(out.status).toBe(302);
    expect(out.headers.get("location")).toBe(`/auth/github?next=${encodeURIComponent(`/ladders/${id}`)}`);
    expect(out.headers.get("cache-control")).toBe("no-store");
    const cookie = await h.learner();
    expect((await h.get(`/ladders/${id}`, cookie)).status).toBe(200);
    const missing = await h.get("/ladders/does-not-exist", cookie);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("cache-control")).toBe("no-store");
    expect(await missing.text()).toContain('<div id="root">');
    expect((await h.get("/ladders/9999", cookie)).status).toBe(404);
  });

  test("sign-in keeps a /ladders/<id> return target and refuses look-alikes", async () => {
    const returnCookie = async (next: string) =>
      (await h.get(`/auth/github?next=${encodeURIComponent(next)}`)).headers
        .getSetCookie()
        .find((c) => c.startsWith("il_return_to="));
    expect(await returnCookie("/ladders/42")).toContain("il_return_to=%2Fladders%2F42");
    expect(await returnCookie("/ladders/42/concepts")).toContain("il_return_to=%2Fladders%2F42%2Fconcepts");
    for (const bad of [
      "/ladders/42/x",
      "/ladders/42/concepts/x",
      "/ladders/abc/concepts",
      "/ladders/0/concepts",
      "/ladders/abc",
      "//evil.example/ladders/1",
      "/ladders/1%0d%0aX: y",
      "/ladders/",
      "/ladders/0042x",
    ]) {
      expect(await returnCookie(bad)).toBeUndefined();
    }
  });
});
