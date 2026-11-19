// T008 (8a) AC 1 / Success Criterion 1: chunker, embedder and the Inngest step chunk-and-embed after map-concepts.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { InngestTestEngine } from "@inngest/test";
import { MockEmbeddingModelV3 } from "ai/test";
import { CHUNK_OVERLAP, CHUNK_SIZE, chunkFiles, chunkText } from "../src/server/chunker.ts";
import {
  createOpenAIEmbedder,
  type Embedder,
  EmbedderNotConfiguredError,
  embedderFromModel,
} from "../src/server/embedder.ts";
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
import { mockEmbedder } from "./support/mock-embedder.ts";
import { testModelA, testReader } from "./support/mock-model.ts";

const letters = (n: number) => Array.from({ length: n }, (_, i) => String.fromCharCode(97 + (i % 26))).join("");

describe("chunk-and-embed chunker", () => {
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

describe("chunk-and-embed embedder", () => {
  test("embedMany through an AI SDK embedding model: vectors and usage tokens", async () => {
    const model = new MockEmbeddingModelV3({
      doEmbed: async ({ values }) => ({
        embeddings: values.map((v) => [v.length, v.charCodeAt(0)]),
        usage: { tokens: 11 },
        warnings: [],
      }),
    });
    const e = embedderFromModel(model, "text-embedding-3-small");
    expect(await e.embedTexts(["a", "b"])).toEqual({
      embeddings: [
        [1, 97],
        [1, 98],
      ],
      tokens: 22,
    }); // one call per value here; usage is summed;
    expect(await e.embedTexts([])).toEqual({ embeddings: [], tokens: 0 });
    expect(e.model).toBe("text-embedding-3-small");
  });

  test("no OPENAI_API_KEY: fails naming the key, never a mock vector", async () => {
    const e = createOpenAIEmbedder({ modelId: "text-embedding-3-small" });
    const err = await e.embedTexts(["x"]).catch((x: unknown) => x);
    expect(err).toBeInstanceOf(EmbedderNotConfiguredError);
    expect(String(err)).toContain("OPENAI_API_KEY");
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
  await db.sql`SELECT source, path, ordinal, start_line, end_line, text, embedding_model, vector_dims(embedding) AS dims
    FROM chunks WHERE repo_full_name = ${MITT.repo} AND commit_sha = ${MITT.sha} ORDER BY id`;
const modelA = testModelA(); // answers the mapper and the 8b level generators
/** File text served for every contents read: 120 numbered lines, so each file gives 2+ chunks. */
const fileText = (path: string) => Array.from({ length: 120 }, (_, i) => `${path} line ${i + 1}`).join("\n");

function engine(jobId: string, embedder: Embedder, costs: CostEntry[] = []) {
  const gh = fixtureFetch(fixtures, (path) => {
    const m = path.match(/^\/repos\/developit\/mitt\/contents\/([^?]+)\?ref=/);
    return m ? new Response(fileText(decodeURIComponent(m[1] as string))) : undefined;
  });
  const fn = ladderGenerateFunction(createInngest(), {
    sql: db.sql,
    github: githubRepoClient({ baseUrl: "https://api.github.com", token: "t", fetch: gh.impl }),
    reader: { ...testReader(), logCost: (e) => costs.push(e) },
    modelA,
    embedder,
  });
  return new InngestTestEngine({ function: fn, events: [{ name: LADDER_GENERATE_EVENT, data: { ...MITT, jobId } }] });
}

describe("Inngest step chunk-and-embed (AC 1, Success Criterion 1)", () => {
  test("developit/mitt: after map-concepts, chunks stored with line ranges and embeddings; a re-run adds 0 rows", async () => {
    const jobId = await newJob();
    const embedder = mockEmbedder();
    const costs: CostEntry[] = [];
    const { result, ctx } = await engine(jobId, embedder, costs).execute();
    expect(ctx.step.run.mock.calls.map((c) => c[0])).toEqual([
      "fetch-repo",
      "pick-core-files",
      "map-concepts",
      "chunk-and-embed",
      ...["L0", "L1", "L2", "L3", "L4"].map((l) => `generate-level-${l}`),
      "check-and-dedupe",
    ]);
    const rows = await chunkRows();
    expect(result).toMatchObject({ status: "mapped", chunks: rows.length });
    expect((await jobRow(jobId)).status).toBe("mapped"); // the final status stays mapped until save-ladder (8d)
    const sources = new Set(rows.map((r: { source: string }) => r.source));
    expect([...sources].sort()).toEqual(["core", "dep", "readme"]);
    const core = await db.sql`SELECT path FROM core_files WHERE repo_full_name = ${MITT.repo} ORDER BY rank`;
    for (const { path } of core) expect(rows.some((r: { path: string }) => r.path === path)).toBe(true);
    for (const r of rows) {
      expect(r.start_line).toBeGreaterThanOrEqual(1);
      expect(r.end_line).toBeGreaterThanOrEqual(r.start_line);
      expect(r.text.length).toBeLessThanOrEqual(1_500);
      expect([r.embedding_model, r.dims]).toEqual(["mock-embedding", 1536]);
    }
    const dep = rows.filter((r: { source: string }) => r.source === "dep");
    expect(dep.map((r: { path: string; ordinal: number }) => `${r.path}#${r.ordinal}`)).toEqual([
      "package.json#0",
      "package.json#1",
    ]);
    expect(dep[1].start_line).toBeLessThan(dep[0].end_line + 1); // the overlap repeats the end of chunk 0
    // The first call embeds the chunks; check-and-dedupe (8c) embeds items after it (the test engine may re-run it).
    expect(embedder.calls[0]).toHaveLength(rows.length);
    const tokens = (embedder.calls[0] ?? []).reduce((n, t) => n + Math.ceil(t.length / 4), 0);
    expect(costs.filter((c) => c.step === "chunk-and-embed")).toEqual([
      {
        jobId,
        repo: MITT.repo,
        sha: MITT.sha,
        step: "chunk-and-embed",
        backend: "api",
        model: "mock-embedding",
        inputTokens: tokens,
        outputTokens: 0,
        cachedInputTokens: 0,
      },
    ]);

    // Re-run for the same repo + SHA: no new row, no chunk embedding call (only check-and-dedupe embeds again).
    await engine(jobId, embedder, costs).execute();
    expect((await chunkRows()).length).toBe(rows.length);
    expect(costs.filter((c) => c.step === "chunk-and-embed")).toHaveLength(1);
  });

  test("no OPENAI_API_KEY: the job fails embedder-not-configured at once, no chunk stored", async () => {
    const jobId = await newJob();
    const { result } = await engine(jobId, createOpenAIEmbedder({ modelId: "text-embedding-3-small" })).execute();
    expect(result).toEqual({ status: "failed", reason: "embedder-not-configured" });
    expect(await jobRow(jobId)).toEqual({ status: "failed", reason: "embedder-not-configured" });
    expect(await chunkRows()).toEqual([]);
  });

  test("a vector of the wrong dimension fails the job embedder-error, no chunk stored", async () => {
    const jobId = await newJob();
    const { result } = await engine(jobId, mockEmbedder(3)).execute();
    expect(result).toEqual({ status: "failed", reason: "embedder-error" });
    expect(await chunkRows()).toEqual([]);
  });
});
