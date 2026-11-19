// T007 AC 4 and 5 (server part): GET/PUT /api/ladders/:ladderId/concepts on the test DB.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { V0_REPOS } from "./support/github-fixtures.ts";
import { BASE, startHarness } from "./support/start-harness.ts";

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

const SHARED = ["Event emitter", "Observer pattern", "Typed events"];

/** A ladder row plus (unless `shared` is false) the shared concepts and confidence of its repo + SHA. */
async function seed(opts: { shared?: boolean; fallback?: boolean } = {}): Promise<string> {
  if (opts.shared === false) {
    const [bare] = await sql()`
      INSERT INTO ladders (repo_full_name, commit_sha, status) VALUES ('other/repo', ${"a".repeat(40)}, 'unverified') RETURNING id::text AS id`;
    return bare.id;
  }
  const [l] = await sql()`
    INSERT INTO ladders (repo_full_name, commit_sha, status) VALUES ('developit/mitt', ${SHA}, 'unverified') RETURNING id::text AS id`;
  await sql()`
    INSERT INTO repo_snapshots (repo_full_name, commit_sha, default_branch, archived, readme, topics, languages, dep_files,
      open_issues, good_first_issues, tree, tree_truncated)
    VALUES ('developit/mitt', ${SHA}, 'main', false, 'r', '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, 0, 0, '[]'::jsonb, false)
    ON CONFLICT DO NOTHING`;
  await sql()`
    INSERT INTO repo_confidence (repo_full_name, commit_sha, score, level, fallback_to_concepts, reasons)
    VALUES ('developit/mitt', ${SHA}, 0.2, 'low', ${opts.fallback === true}, '[]'::jsonb) ON CONFLICT DO NOTHING`;
  for (const [i, name] of SHARED.entries())
    await sql()`
      INSERT INTO repo_concepts (repo_full_name, commit_sha, position, name, slug, reason, basis)
      VALUES ('developit/mitt', ${SHA}, ${i + 1}, ${name}, ${name.toLowerCase().replace(/ /g, "-")}, ${`why ${name}`}, '["readme"]'::jsonb)`;
  return l.id;
}

const put = (id: string, body: unknown, cookie?: string) =>
  h.app.request(`${BASE}/api/ladders/${id}/concepts`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const names = (list: string[]) => ({ concepts: list.map((name) => ({ name })) });
const sharedRows = async () => JSON.stringify(await sql()`SELECT * FROM repo_concepts ORDER BY position`);

describe("GET /api/ladders/:id/concepts", () => {
  test("no learner list: the shared concepts in position order with reasons and the fallback flag", async () => {
    const id = await seed({ fallback: true });
    const res = await h.get(`/api/ladders/${id}/concepts`, await h.learner());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      concepts: SHARED.map((name) => ({ name, slug: name.toLowerCase().replace(/ /g, "-"), reason: `why ${name}` })),
      edited: false,
      fallbackToConcepts: true,
    });
  });

  test("401 signed out; 404 unknown id, malformed id, and a ladder with no repo_concepts", async () => {
    const id = await seed();
    expect((await h.get(`/api/ladders/${id}/concepts`)).status).toBe(401);
    const cookie = await h.learner();
    for (const bad of ["9999", "does-not-exist"]) {
      const res = await h.get(`/api/ladders/${bad}/concepts`, cookie);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not-found" });
    }
    const bare = await seed({ shared: false });
    const res = await h.get(`/api/ladders/${bare}/concepts`, cookie);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "concepts-not-found" });
  });
});

describe("PUT /api/ladders/:id/concepts (Success Criteria 3 and 4)", () => {
  test("learner A saves and sees the list; learner B and repo_concepts are unchanged", async () => {
    const id = await seed();
    const [a, b] = [await h.learner(), await h.learner()];
    const before = await sharedRows();
    const list = ["Event emitter", "Pub/sub", "TypeScript generics"];
    const saved = await put(id, names(["  Event emitter ", "Pub/sub", "TypeScript generics"]), a);
    expect(saved.status).toBe(200);
    expect(saved.headers.get("cache-control")).toBe("no-store");
    const aBody = (await (await h.get(`/api/ladders/${id}/concepts`, a)).json()) as {
      concepts: { name: string; slug: string; reason?: string }[];
      edited: boolean;
    };
    expect(aBody.edited).toBe(true);
    expect(aBody.concepts.map((c) => c.name)).toEqual(list);
    expect(aBody.concepts.map((c) => c.slug)).toEqual(["event-emitter", "pub-sub", "typescript-generics"]);
    expect(aBody.concepts[0]?.reason).toBe("why Event emitter"); // name matches a shared concept
    expect(aBody.concepts[1]?.reason).toBeUndefined();
    const bBody = (await (await h.get(`/api/ladders/${id}/concepts`, b)).json()) as {
      concepts: { name: string }[];
      edited: boolean;
    };
    expect(bBody.edited).toBe(false);
    expect(bBody.concepts.map((c) => c.name)).toEqual(SHARED);
    expect(await sharedRows()).toBe(before);
  });

  test("a second save replaces the first (last write wins): one row per learner and ladder", async () => {
    const id = await seed();
    const a = await h.learner();
    await put(id, names(["One more", "Two more", "Three more"]), a);
    expect((await put(id, names(["Alpha", "Beta", "Gamma", "Delta"]), a)).status).toBe(200);
    const body = (await (await h.get(`/api/ladders/${id}/concepts`, a)).json()) as { concepts: { name: string }[] };
    expect(body.concepts.map((c) => c.name)).toEqual(["Alpha", "Beta", "Gamma", "Delta"]);
    expect((await sql()`SELECT 1 FROM learner_concepts`).length).toBe(1);
  });

  test("422 names the field: 2 and 7 concepts, empty name, 61 code points, duplicate slug, NUL and DEL", async () => {
    const id = await seed();
    const a = await h.learner();
    const cases: [string, unknown, string][] = [
      ["2 concepts", names(["Alpha", "Beta"]), "concepts"],
      ["7 concepts", names(["a1", "b2", "c3", "d4", "e5", "f6", "g7"]), "concepts"],
      ["empty name", names(["Alpha", "  ", "Gamma"]), "concepts[1].name"],
      ["61 code points", names(["Alpha", "Beta", "😀".repeat(61)]), "concepts[2].name"],
      ["case duplicate", names(["Embeddings", "Beta", "embeddings"]), "concepts[2].slug"],
      ["NUL", names(["Alpha", "Be\u0000ta", "Gamma"]), "concepts[1].name"],
      ["DEL", names(["Alpha", "Beta", "Ga\u007fmma"]), "concepts[2].name"],
      ["not an array", { concepts: "x" }, "concepts"],
      ["name not a string", { concepts: [{ name: 1 }, { name: "Beta" }, { name: "Gamma" }] }, "concepts[0].name"],
      ["no body", "not json", "concepts"],
    ];
    for (const [label, body, field] of cases) {
      const res = await put(id, body, a);
      expect([label, res.status]).toEqual([label, 422]);
      const out = (await res.json()) as { field: string; message: string };
      expect([label, out.field]).toEqual([label, field]);
      expect(out.message.length).toBeGreaterThan(0);
    }
    expect((await sql()`SELECT 1 FROM learner_concepts`).length).toBe(0);
  });

  test("60 code points is accepted (emoji count 1 each)", async () => {
    const id = await seed();
    expect((await put(id, names(["Alpha", "Beta", "😀".repeat(60)]), await h.learner())).status).toBe(200);
  });

  test("401 signed out; 404 unknown ladder or no shared concepts; another learner's ladder id works like the view route", async () => {
    const id = await seed();
    expect((await put(id, names(SHARED))).status).toBe(401);
    const cookie = await h.learner();
    expect((await put("9999", names(SHARED), cookie)).status).toBe(404);
    expect((await put("nope", names(SHARED), cookie)).status).toBe(404);
    const bare = await seed({ shared: false });
    expect((await put(bare, names(SHARED), cookie)).status).toBe(404);
    expect((await sql()`SELECT 1 FROM learner_concepts`).length).toBe(0);
  });
});

describe("GET /ladders/:id/concepts (page)", () => {
  test("signed out -> sign-in returning to the concepts page; signed in -> client 200; unknown -> client 404", async () => {
    const id = await seed();
    const out = await h.get(`/ladders/${id}/concepts`);
    expect(out.status).toBe(302);
    expect(out.headers.get("location")).toBe(`/auth/github?next=${encodeURIComponent(`/ladders/${id}/concepts`)}`);
    const cookie = await h.learner();
    const ok = await h.get(`/ladders/${id}/concepts`, cookie);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect(await ok.text()).toContain('<div id="root">');
    expect((await h.get("/ladders/9999/concepts", cookie)).status).toBe(404);
  });
});
