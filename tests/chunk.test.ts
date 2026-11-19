// T008 (8a) AC 1, T031 AC 2 / Success Criterion 2: chunker and the Inngest step chunk after map-concepts (no embedding).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { InngestTestEngine } from "@inngest/test";
import { CHUNK_OVERLAP, CHUNK_SIZE, chunkFiles, chunkText } from "../src/server/chunker.ts";
import { githubRepoClient } from "../src/server/github-repo.ts";
import {
  type CostEntry,
  createInngest,
  LADDER_GENERATE_EVENT,
  ladderGenerateFunction,
} from "../src/server/ladder-generate.ts";
import { migrateUp } from "../src/server/migrate.ts";
import { createTestDatabase } from "./support/db.ts";
import { type Fixture, fixtureFetch, loadFixture, V0_REPOS } from "./support/github-fixtures.ts";
import { drainInngestRuns } from "./support/inngest-drain.ts";
import { testModelA, testReader } from "./support/mock-model.ts";

const letters = (n: number) => Array.from({ length: n }, (_, i) => String.fromCharCode(97 + (i % 26))).join("");

describe("chunker", () => {
  test("~1,500-char windows with 200 overlap cover the whole text", () => {
    const text = letters(3_500);
    const pieces = chunkText(text);
    expect([CHUNK_SIZE, CHUNK_OVERLAP]).toEqual([1_500, 200]);
    expect(pieces.map((p) => p.text.length)).toEqual([1_500, 1_500, 900]);
    expect(pieces[1]?.text.slice(0, 200)).toBe(pieces[0]?.text.slice(-200));
    expect(pieces[2]?.text.endsWith(text.slice(-50))).toBe(true);
  });

  test("line ranges: a window ends after a full line; the overlap starts mid-file at the right line", () => {
    const text = Array.from({ length: 100 }, (_, i) => `line ${String(i + 1).padStart(3, "0")}`.padEnd(29, ".")).join(
      "\n",
    );
    const pieces = chunkText(`${text}\n`);
    expect(pieces[0]).toMatchObject({ startLine: 1, endLine: 50 });
    expect(pieces[0]?.text.endsWith("\n")).toBe(true);
    expect(pieces[1]?.startLine).toBe(44);
    expect(pieces.at(-1)?.endLine).toBe(100);
    for (const p of pieces) expect(p.text.length).toBeLessThanOrEqual(CHUNK_SIZE);
  });

  test("chunkFiles: path, ordinal, sha per chunk; empty and blank files give none", () => {
    const sha = "a".repeat(40);
    const chunks = chunkFiles(sha, [
      { source: "readme", path: "README.md", text: "# mitt\nTiny event emitter.\n" },
      { source: "core", path: "src/index.ts", text: letters(2_000) },
      { source: "dep", path: "package.json", text: "" },
      { source: "docs", path: "docs/a.md", text: "  \n " },
    ]);
    expect(chunks.map((c) => [c.source, c.path, c.ordinal, c.sha, c.startLine, c.endLine])).toEqual([
      ["readme", "README.md", 0, sha, 1, 2],
      ["core", "src/index.ts", 0, sha, 1, 1],
      ["core", "src/index.ts", 1, sha, 1, 1],
    ]);
  });
});

let db: Awaited<ReturnType<typeof createTestDatabase>>;
let fixtures: Fixture[];
beforeAll(async () => {
  db = await createTestDatabase();
  await migrateUp(db.sql);
  fixtures = [await loadFixture("developit/mitt")];
});
afterAll(async () => {
  await db.drop();
});
// A test's parallel run keeps steps going after `execute()` returns: let them end before the next test truncates.
afterEach(drainInngestRuns);
beforeEach(async () => {
  await db.sql`TRUNCATE generation_jobs, repo_snapshots CASCADE`;
});

const MITT = { repo: "developit/mitt", sha: V0_REPOS["developit/mitt"] };
const newJob = async () =>
  (
    await db.sql`
    INSERT INTO generation_jobs (repo_full_name, commit_sha) VALUES (${MITT.repo}, ${MITT.sha}) RETURNING id::text`
  )[0].id as string;
const jobRow = async (id: string) =>
  (await db.sql`SELECT status, reason FROM generation_jobs WHERE id = ${id}`)[0] as { status: string; reason: string };
const chunkRows = async () =>
  await db.sql`SELECT source, path, ordinal, start_line, end_line, text
    FROM chunks WHERE repo_full_name = ${MITT.repo} AND commit_sha = ${MITT.sha} ORDER BY id`;
const modelA = testModelA(); // answers the mapper and the 8b level generators
/** File text served for every contents read: 120 numbered lines, so each file gives 2+ chunks. */
const fileText = (path: string) => Array.from({ length: 120 }, (_, i) => `${path} line ${i + 1}`).join("\n");

function engine(jobId: string, costs: CostEntry[] = []) {
  const gh = fixtureFetch(fixtures, (path) => {
    const m = path.match(/^\/repos\/developit\/mitt\/contents\/([^?]+)\?ref=/);
    return m ? new Response(fileText(decodeURIComponent(m[1] as string))) : undefined;
  });
  const fn = ladderGenerateFunction(createInngest(), {
    sql: db.sql,
    github: githubRepoClient({ baseUrl: "https://api.github.com", token: "t", fetch: gh.impl }),
    reader: { ...testReader(), logCost: (e) => costs.push(e) },
    modelA,
  });
  return new InngestTestEngine({ function: fn, events: [{ name: LADDER_GENERATE_EVENT, data: { ...MITT, jobId } }] });
}

describe("Inngest step chunk (T031 AC 2, Success Criterion 2)", () => {
  test("developit/mitt, no OPENAI_API_KEY in env: chunks stored with line ranges and no vector; a re-run adds 0 rows", async () => {
    expect(process.env.OPENAI_API_KEY).toBeUndefined();
    const jobId = await newJob();
    const costs: CostEntry[] = [];
    const { result, ctx } = await engine(jobId, costs).execute();
    expect(ctx.step.run.mock.calls.map((c) => c[0])).toEqual([
      "fetch-repo",
      "pick-core-files",
      "map-concepts",
      "chunk",
      ...["L0", "L1", "L2", "L3", "L4"].map((l) => `generate-level-${l}`),
      "check-and-dedupe",
      "save-ladder",
    ]);
    const rows = await chunkRows();
    expect(result).toMatchObject({ status: "done", chunks: rows.length });
    expect((await jobRow(jobId)).status).toBe("done");
    const sources = new Set(rows.map((r: { source: string }) => r.source));
    expect([...sources].sort()).toEqual(["core", "dep", "readme"]);
    const core = await db.sql`SELECT path FROM core_files WHERE repo_full_name = ${MITT.repo} ORDER BY rank`;
    for (const { path } of core) expect(rows.some((r: { path: string }) => r.path === path)).toBe(true);
    for (const r of rows) {
      expect(r.start_line).toBeGreaterThanOrEqual(1);
      expect(r.end_line).toBeGreaterThanOrEqual(r.start_line);
      expect(r.text.length).toBeLessThanOrEqual(1_500);
    }
    const cols = await db.sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'chunks'`;
    expect(cols.map((c: { column_name: string }) => c.column_name)).not.toContain("embedding");
    const dep = rows.filter((r: { source: string }) => r.source === "dep");
    expect(dep.map((r: { path: string; ordinal: number }) => `${r.path}#${r.ordinal}`)).toEqual([
      "package.json#0",
      "package.json#1",
    ]);
    expect(dep[1].start_line).toBeLessThan(dep[0].end_line + 1); // the overlap repeats the end of chunk 0
    // The chunk step makes no model call, so it logs no cost.
    expect(costs.filter((c) => c.step === "chunk")).toEqual([]);

    // Re-run for the same repo + SHA: no new row.
    await engine(jobId, costs).executeStep("chunk");
    expect((await chunkRows()).length).toBe(rows.length);
  });
});
