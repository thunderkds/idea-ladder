// Background ladder generation (Inngest). Steps: fetch-repo (T005), pick-core-files (T006), map-concepts (T007), chunk-and-embed and generate-level-L0..L4 (T008); later tasks append more.
import { APICallError, type LanguageModel } from "ai";
import type { SQL } from "bun";
import { Inngest, NonRetriableError } from "inngest";
import { LEVEL_IDS, type LevelId } from "../shared/levels.ts";
import { chunkFiles, type SourceFile } from "./chunker.ts";
import { pickCoreFilesClaudeCode, ReaderNotInstalledError } from "./claude-code-reader.ts";
import { MAP_CONCEPTS_STEP, MapperInvalidOutputError, mapConcepts } from "./concept-mapper.ts";
import { type Confidence, confidenceScore } from "./confidence.ts";
import { EMBEDDING_DIMENSIONS, type Embedder, EmbedderNotConfiguredError, type EmbedResult } from "./embedder.ts";
import { GitHubError, type GithubRepoClient, RateLimitError, RepoNotFoundError } from "./github-repo.ts";
import { generateLevel, LEVEL_SOURCES, type LevelChunk, LevelGeneratorInvalidOutputError } from "./level-generator.ts";
import { type ModelADeps, ModelANotInstalledError } from "./model-a.ts";
import {
  type CallUsage,
  type CoreFile,
  PICK_CORE_FILES_STEP,
  pickCoreFiles,
  ReaderBudgetError,
  ReaderInvalidOutputError,
  type ReaderLimits,
  type ReadFile,
  type TreeEntry,
} from "./repo-reader.ts";

export const LADDER_GENERATE_EVENT = "ladder/generate.requested";
export type GenerateRequested = { repo: string; sha: string; jobId: string };

/** Mode and keys come from env (INNGEST_DEV, INNGEST_EVENT_KEY, INNGEST_SIGNING_KEY), read by the SDK. */
export const createInngest = () => new Inngest({ id: "idea-ladder" });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function eventData(data: unknown): GenerateRequested {
  const d = data as Partial<GenerateRequested>;
  if (
    typeof d?.repo !== "string" ||
    typeof d.sha !== "string" ||
    !/^[0-9a-f]{40}$/.test(d.sha) ||
    typeof d.jobId !== "string" ||
    !UUID.test(d.jobId)
  ) {
    throw new NonRetriableError("invalid ladder/generate.requested payload");
  }
  return { repo: d.repo, sha: d.sha, jobId: d.jobId };
}

async function failJob(sql: SQL, jobId: string, reason: string, resetAt?: Date) {
  await sql`
    UPDATE generation_jobs SET status = 'failed', reason = ${reason}, reset_at = ${resetAt ?? null}, updated_at = now()
    WHERE id = ${jobId} AND status IN ('queued', 'running', 'fetched', 'picking', 'picked', 'mapping', 'mapped')`;
}

export type CostEntry = CallUsage & {
  jobId: string;
  repo: string;
  sha: string;
  step: string;
  backend: "api" | "claude-code";
};
/** Model A back end: `api` (AI SDK model) or `claude-code` (`claude -p` on the subscription, see AC 9). */
export type ReaderDeps = { limits: ReaderLimits; logCost: (entry: CostEntry) => void } & (
  | { backend?: "api"; model: LanguageModel }
  | {
      backend: "claude-code";
      modelId?: string;
      githubToken?: string;
      githubApiBaseUrl?: string;
      claudeBin?: string;
    }
);
/** `embedder` is absent only in the T005-T007 step tests that end at map-concepts; main.ts always sets it. */
type Deps = { sql: SQL; github: GithubRepoClient; reader: ReaderDeps; modelA: ModelADeps; embedder?: Embedder };

/** Reads the repo at the pinned SHA, scores confidence, stores both; all-or-nothing. Throws only to be retried. */
async function fetchRepo({ sql, github }: Deps, { jobId }: GenerateRequested) {
  // Trust only the job row for repo + SHA: the event payload is not authenticated data.
  const [job] = await sql`SELECT repo_full_name, commit_sha FROM generation_jobs WHERE id = ${jobId}`;
  if (!job) throw new NonRetriableError(`unknown job ${jobId}`);
  const repo = job.repo_full_name as string;
  const sha = job.commit_sha as string;
  await sql`UPDATE generation_jobs SET status = 'running', updated_at = now() WHERE id = ${jobId} AND status = 'queued'`;
  let snapshot: Awaited<ReturnType<GithubRepoClient["fetchSnapshot"]>>;
  try {
    snapshot = await github.fetchSnapshot(repo, sha);
  } catch (err) {
    // Retrying cannot help these: fail the job now, with no snapshot (no partial ladder).
    if (err instanceof RateLimitError) {
      await failJob(sql, jobId, "rate-limited", err.resetAt);
      return { status: "failed", reason: "rate-limited", resetAt: err.resetAt.toISOString() } as const;
    }
    if (err instanceof RepoNotFoundError || (err instanceof GitHubError && !err.transient)) {
      const reason = err instanceof RepoNotFoundError ? "repo-not-found" : "github-error";
      await failJob(sql, jobId, reason);
      return { status: "failed", reason } as const;
    }
    throw err; // 5xx, timeout, network: Inngest retries this step alone
  }
  const confidence = confidenceScore(snapshot);
  // Bun SQL binds objects and arrays as JSON for ::jsonb (a JSON.stringify'd string would be stored as a string).
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO repo_snapshots (repo_full_name, commit_sha, default_branch, archived, readme, topics, languages,
        dep_files, open_issues, good_first_issues, tree, tree_truncated)
      VALUES (${repo}, ${sha}, ${snapshot.defaultBranch}, ${snapshot.archived}, ${snapshot.readme},
        ${snapshot.topics}::jsonb, ${snapshot.languages}::jsonb, ${snapshot.depFiles}::jsonb,
        ${snapshot.openIssues}, ${snapshot.goodFirstIssues}, ${snapshot.tree}::jsonb, ${snapshot.treeTruncated})
      ON CONFLICT DO NOTHING`;
    await tx`
      INSERT INTO repo_confidence (repo_full_name, commit_sha, score, level, fallback_to_concepts, reasons)
      VALUES (${repo}, ${sha}, ${confidence.score}, ${confidence.level}, ${confidence.fallbackToConcepts},
        ${confidence.reasons}::jsonb)
      ON CONFLICT DO NOTHING`;
    await tx`UPDATE generation_jobs SET status = 'fetched', updated_at = now() WHERE id = ${jobId}`;
  });
  return { status: "fetched", confidence } as const;
}

/** Reads through repo_file_cache, so a retried step makes no GitHub call for a file it already read. */
function cachedReadFile(sql: SQL, github: GithubRepoClient, repo: string, sha: string): ReadFile {
  return async (path) => {
    const [hit] = await sql`
      SELECT content FROM repo_file_cache WHERE repo_full_name = ${repo} AND commit_sha = ${sha} AND path = ${path}`;
    if (hit) return hit.content as string | null;
    const content = await github.readFile(repo, sha, path);
    try {
      await sql`
        INSERT INTO repo_file_cache (repo_full_name, commit_sha, path, content) VALUES (${repo}, ${sha}, ${path}, ${content})
        ON CONFLICT DO NOTHING`;
    } catch (err) {
      // The cache only saves GitHub calls on a retry: a failed write must not fail (and so re-run) the paid loop.
      console.warn(JSON.stringify({ event: "repo-file-cache-write-failed", repo, sha, path, error: String(err) }));
    }
    return content;
  };
}

/** The bounded reader as a tool of the workflow: stores 3-10 ranked core files for the repo + SHA. */
async function pickCoreFilesStep({ sql, github, reader }: Deps, { jobId }: GenerateRequested) {
  const [job] = await sql`SELECT repo_full_name, commit_sha, status FROM generation_jobs WHERE id = ${jobId}`;
  if (!job) throw new NonRetriableError(`unknown job ${jobId}`);
  const repo = job.repo_full_name as string;
  const sha = job.commit_sha as string;
  if (job.status === "failed") return { status: "failed", reason: "job-failed" } as const;
  const stored = async (): Promise<CoreFile[]> =>
    await sql`SELECT path, reason FROM core_files WHERE repo_full_name = ${repo} AND commit_sha = ${sha} ORDER BY rank`;
  let coreFiles = await stored();
  if (coreFiles.length === 0) {
    await sql`
      UPDATE generation_jobs SET status = 'picking', updated_at = now() WHERE id = ${jobId} AND status = 'fetched'`;
    const [snap] = await sql`
      SELECT tree, tree_truncated FROM repo_snapshots WHERE repo_full_name = ${repo} AND commit_sha = ${sha}`;
    if (!snap) throw new NonRetriableError(`no snapshot for ${repo}@${sha}`);
    const backend = reader.backend ?? "api";
    const onUsage = (u: CallUsage) => reader.logCost({ ...u, jobId, repo, sha, step: PICK_CORE_FILES_STEP, backend });
    const common = {
      repo,
      sha,
      tree: snap.tree as TreeEntry[],
      treeTruncated: snap.tree_truncated as boolean,
      limits: reader.limits,
      onUsage,
    };
    try {
      // A ReaderFailedError (claude-code: timeout, exit, is_error) falls through to the retry below.
      ({ coreFiles } =
        reader.backend === "claude-code"
          ? await pickCoreFilesClaudeCode({
              ...common,
              modelId: reader.modelId,
              githubToken: reader.githubToken,
              githubApiBaseUrl: reader.githubApiBaseUrl,
              claudeBin: reader.claudeBin,
            })
          : await pickCoreFiles({ ...common, model: reader.model, readFile: cachedReadFile(sql, github, repo, sha) }));
    } catch (err) {
      if (
        err instanceof ReaderInvalidOutputError ||
        err instanceof ReaderBudgetError ||
        err instanceof ReaderNotInstalledError
      ) {
        await failJob(sql, jobId, err.code);
        return { status: "failed", reason: err.code } as const;
      }
      // A retry cannot help these (400 prompt too long, 401 bad key): fail now, no paid re-run.
      if (APICallError.isInstance(err) && !err.isRetryable) {
        console.warn(JSON.stringify({ event: "reader-error", jobId, repo, sha, error: String(err) }));
        await failJob(sql, jobId, "reader-error");
        return { status: "failed", reason: "reader-error" } as const;
      }
      throw err; // model 429/529, GitHub 5xx: Inngest retries this step
    }
    // One writer per repo + SHA: a concurrent job waits here, then sees the rows and keeps them (no mixed picks).
    await sql.begin(async (tx) => {
      await tx`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`core_files:${repo}@${sha}`}, 0))`;
      const [existing] = await tx`
        SELECT count(*)::int AS n FROM core_files WHERE repo_full_name = ${repo} AND commit_sha = ${sha}`;
      if (existing?.n > 0) return;
      for (const [i, f] of coreFiles.entries()) {
        await tx`
          INSERT INTO core_files (repo_full_name, commit_sha, rank, path, reason)
          VALUES (${repo}, ${sha}, ${i + 1}, ${f.path}, ${f.reason})`;
      }
    });
    coreFiles = await stored(); // another job for the same repo + SHA may have stored its picks first
  }
  await sql`
    UPDATE generation_jobs SET status = 'picked', updated_at = now() WHERE id = ${jobId} AND status IN ('fetched', 'picking')`;
  return { status: "picked", coreFiles: coreFiles.map((f) => ({ path: f.path, reason: f.reason })) } as const;
}

/** One structured model A call maps the repo to 3-6 concepts; stores them for the repo + SHA. */
async function mapConceptsStep({ sql, reader, modelA }: Deps, { jobId }: GenerateRequested) {
  const [job] = await sql`SELECT repo_full_name, commit_sha, status FROM generation_jobs WHERE id = ${jobId}`;
  if (!job) throw new NonRetriableError(`unknown job ${jobId}`);
  const repo = job.repo_full_name as string;
  const sha = job.commit_sha as string;
  if (job.status === "failed") return { status: "failed", reason: "job-failed" } as const;
  const coreFiles: CoreFile[] =
    await sql`SELECT path, reason FROM core_files WHERE repo_full_name = ${repo} AND commit_sha = ${sha} ORDER BY rank`;
  const [conf] = await sql`
    SELECT score, level, fallback_to_concepts, reasons FROM repo_confidence WHERE repo_full_name = ${repo} AND commit_sha = ${sha}`;
  if (!conf) throw new NonRetriableError(`no confidence for ${repo}@${sha}`);
  const confidence: Confidence = {
    score: conf.score,
    level: conf.level,
    fallbackToConcepts: conf.fallback_to_concepts === true,
    reasons: conf.reasons,
  };
  const stored = async () =>
    await sql`
      SELECT name, slug, reason, basis FROM repo_concepts WHERE repo_full_name = ${repo} AND commit_sha = ${sha} ORDER BY position`;
  let concepts = await stored();
  if (concepts.length === 0) {
    await sql`UPDATE generation_jobs SET status = 'mapping', updated_at = now() WHERE id = ${jobId} AND status = 'picked'`;
    const [snap] = await sql`
      SELECT readme, topics, languages, dep_files FROM repo_snapshots WHERE repo_full_name = ${repo} AND commit_sha = ${sha}`;
    if (!snap) throw new NonRetriableError(`no snapshot for ${repo}@${sha}`);
    let mapped: Awaited<ReturnType<typeof mapConcepts>>;
    try {
      mapped = await mapConcepts({
        snapshot: {
          repo,
          readme: snap.readme,
          topics: snap.topics,
          languages: snap.languages,
          depFiles: snap.dep_files,
        },
        coreFiles,
        confidence,
        generate: modelA.generate,
        onUsage: (u) => reader.logCost({ ...u, jobId, repo, sha, step: MAP_CONCEPTS_STEP, backend: modelA.backend }),
      });
    } catch (err) {
      if (err instanceof MapperInvalidOutputError || err instanceof ModelANotInstalledError) {
        await failJob(sql, jobId, err.code);
        return { status: "failed", reason: err.code } as const;
      }
      // A retry cannot help these (400 prompt too long, 401 bad key): fail now, no paid re-run.
      if (APICallError.isInstance(err) && !err.isRetryable) {
        console.warn(JSON.stringify({ event: "mapper-error", jobId, repo, sha, error: String(err) }));
        await failJob(sql, jobId, "mapper-error");
        return { status: "failed", reason: "mapper-error" } as const;
      }
      throw err; // model 429/529, claude -p timeout: Inngest retries this step
    }
    // One writer per repo + SHA: a concurrent job waits here, then sees the rows and keeps them (no mixed maps).
    await sql.begin(async (tx) => {
      await tx`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`repo_concepts:${repo}@${sha}`}, 0))`;
      const [existing] = await tx`
        SELECT count(*)::int AS n FROM repo_concepts WHERE repo_full_name = ${repo} AND commit_sha = ${sha}`;
      if (existing?.n > 0) return;
      for (const [i, c] of mapped.concepts.entries()) {
        await tx`
          INSERT INTO repo_concepts (repo_full_name, commit_sha, position, name, slug, reason, basis)
          VALUES (${repo}, ${sha}, ${i + 1}, ${c.name}, ${c.slug}, ${c.reason}, ${c.basis}::jsonb)`;
      }
    });
    concepts = await stored(); // another job for the same repo + SHA may have stored its map first
  }
  await sql`
    UPDATE generation_jobs SET status = 'mapped', updated_at = now() WHERE id = ${jobId} AND status IN ('picked', 'mapping')`;
  return {
    status: "mapped",
    coreFiles: coreFiles.map((f) => ({ path: f.path, reason: f.reason })),
    concepts: concepts.map((c: { name: string; slug: string; reason: string; basis: unknown }) => ({
      name: c.name,
      slug: c.slug,
      reason: c.reason,
      basis: c.basis as string[],
    })),
    fallbackToConcepts: confidence.fallbackToConcepts,
  } as const;
}

export const CHUNK_AND_EMBED_STEP = "chunk-and-embed";
/** Docs files chunked at most (sorted by path): a docs-heavy repo must not turn the step into hundreds of reads. */
const MAX_DOC_FILES = 20;
const DOC_PATH = /^docs\/.+\.md$/i;
const README_PATH = /^readme(\.[^/]*)?$/i;

/** Chunks README, docs, dependency files and core files at the pinned SHA; stores them with embeddings once per repo + SHA. */
async function chunkAndEmbedStep(
  { sql, github, reader, embedder }: Deps & { embedder: Embedder },
  { jobId }: GenerateRequested,
) {
  const [job] = await sql`SELECT repo_full_name, commit_sha, status FROM generation_jobs WHERE id = ${jobId}`;
  if (!job) throw new NonRetriableError(`unknown job ${jobId}`);
  const repo = job.repo_full_name as string;
  const sha = job.commit_sha as string;
  if (job.status === "failed") return { status: "failed", reason: "job-failed" } as const;
  const count = async () =>
    (await sql`SELECT count(*)::int AS n FROM chunks WHERE repo_full_name = ${repo} AND commit_sha = ${sha}`)[0]
      .n as number;
  let chunks = await count();
  if (chunks === 0) {
    const [snap] = await sql`
      SELECT readme, tree, dep_files FROM repo_snapshots WHERE repo_full_name = ${repo} AND commit_sha = ${sha}`;
    if (!snap) throw new NonRetriableError(`no snapshot for ${repo}@${sha}`);
    const blobs = (snap.tree as TreeEntry[]).filter((t) => t.type === "blob").map((t) => t.path);
    const core =
      await sql`SELECT path FROM core_files WHERE repo_full_name = ${repo} AND commit_sha = ${sha} ORDER BY rank`;
    const readFile = cachedReadFile(sql, github, repo, sha);
    const files: SourceFile[] = [];
    if (snap.readme)
      files.push({ source: "readme", path: blobs.find((p) => README_PATH.test(p)) ?? "README", text: snap.readme });
    const wanted: [SourceFile["source"], string[]][] = [
      [
        "docs",
        blobs
          .filter((p) => DOC_PATH.test(p))
          .sort()
          .slice(0, MAX_DOC_FILES),
      ],
      ["dep", snap.dep_files as string[]],
      ["core", core.map((r: { path: string }) => r.path)],
    ];
    for (const [source, paths] of wanted)
      for (const path of paths) {
        const text = await readFile(path);
        if (text) files.push({ source, path, text });
      }
    const pieces = chunkFiles(sha, files);
    let embedded: EmbedResult;
    try {
      embedded = await embedder.embedTexts(pieces.map((c) => c.text));
    } catch (err) {
      if (err instanceof EmbedderNotConfiguredError) {
        await failJob(sql, jobId, err.code);
        return { status: "failed", reason: err.code } as const;
      }
      // A retry cannot help these (400, 401 bad key): fail now, no paid re-run.
      if (APICallError.isInstance(err) && !err.isRetryable) {
        console.warn(JSON.stringify({ event: "embedder-error", jobId, repo, sha, error: String(err) }));
        await failJob(sql, jobId, "embedder-error");
        return { status: "failed", reason: "embedder-error" } as const;
      }
      throw err; // 429, 5xx, network: Inngest retries this step
    }
    reader.logCost({
      jobId,
      repo,
      sha,
      step: CHUNK_AND_EMBED_STEP,
      backend: "api",
      model: embedder.model,
      inputTokens: embedded.tokens,
      outputTokens: 0,
      cachedInputTokens: 0,
    });
    const vectors = embedded.embeddings;
    if (vectors.length !== pieces.length || vectors.some((v) => v.length !== EMBEDDING_DIMENSIONS)) {
      console.warn(JSON.stringify({ event: "embedder-bad-vectors", jobId, repo, sha, model: embedder.model }));
      await failJob(sql, jobId, "embedder-error");
      return { status: "failed", reason: "embedder-error" } as const;
    }
    // One writer per repo + SHA: a concurrent job waits here, then sees the rows and keeps them (no mixed chunks).
    await sql.begin(async (tx) => {
      await tx`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`chunks:${repo}@${sha}`}, 0))`;
      const [existing] = await tx`
        SELECT count(*)::int AS n FROM chunks WHERE repo_full_name = ${repo} AND commit_sha = ${sha}`;
      if (existing?.n > 0) return;
      for (const [i, c] of pieces.entries()) {
        await tx`
          INSERT INTO chunks (repo_full_name, commit_sha, source, path, ordinal, start_line, end_line, text, embedding,
            embedding_model)
          VALUES (${repo}, ${sha}, ${c.source}, ${c.path}, ${c.ordinal}, ${c.startLine}, ${c.endLine}, ${c.text},
            ${`[${(vectors[i] as number[]).join(",")}]`}::vector, ${embedder.model})`;
      }
    });
    chunks = await count();
  }
  return { status: "chunked", chunks } as const;
}

export const generateLevelStepId = (level: LevelId) => `generate-level-${level}` as const;
/** Tree paths sent to the L2 generator at most. */
const MAX_TREE_PATHS = 200;
const LEVEL_STEP = /generate-level-L[0-4]/;

/** One model A generator for one level, grounded in that level's chunks. Stores nothing: save-ladder (8d) writes. */
async function generateLevelStep(
  { sql, reader, modelA }: Deps,
  { jobId }: GenerateRequested,
  level: LevelId,
  concepts: { name: string; reason: string }[],
) {
  const stepId = generateLevelStepId(level);
  const [job] = await sql`SELECT repo_full_name, commit_sha, status FROM generation_jobs WHERE id = ${jobId}`;
  if (!job) throw new NonRetriableError(`unknown job ${jobId}`);
  const repo = job.repo_full_name as string;
  const sha = job.commit_sha as string;
  if (job.status === "failed") return { status: "failed", reason: "job-failed" } as const;
  const rows = await sql`
    SELECT id::text AS id, source, path, start_line, end_line, text FROM chunks
    WHERE repo_full_name = ${repo} AND commit_sha = ${sha} AND source IN ${sql(LEVEL_SOURCES[level])} ORDER BY chunks.id`;
  const chunks: LevelChunk[] = rows.map(
    (r: {
      id: string;
      source: LevelChunk["source"];
      path: string;
      start_line: number;
      end_line: number;
      text: string;
    }) => ({
      id: Number(r.id),
      source: r.source,
      path: r.path,
      startLine: r.start_line,
      endLine: r.end_line,
      text: r.text,
    }),
  );
  let snapshotExtras: Record<string, unknown> | undefined;
  if (level === "L2" || level === "L4") {
    const [snap] = await sql`
      SELECT tree, open_issues, good_first_issues FROM repo_snapshots WHERE repo_full_name = ${repo} AND commit_sha = ${sha}`;
    if (!snap) throw new NonRetriableError(`no snapshot for ${repo}@${sha}`);
    snapshotExtras =
      level === "L2"
        ? {
            tree: (snap.tree as TreeEntry[])
              .filter((t) => t.type === "blob")
              .map((t) => t.path)
              .slice(0, MAX_TREE_PATHS),
            openIssues: snap.open_issues,
          }
        : { goodFirstIssues: snap.good_first_issues };
  }
  try {
    const out = await generateLevel({
      level,
      chunks,
      ...(level === "L0" ? { concepts } : {}),
      snapshotExtras,
      generate: modelA.generate,
      onUsage: (u) => reader.logCost({ ...u, jobId, repo, sha, step: stepId, backend: modelA.backend }),
    });
    return { status: "generated", level, ...out } as const;
  } catch (err) {
    // A retry cannot help these: fail now, no paid re-run.
    if (
      err instanceof LevelGeneratorInvalidOutputError ||
      err instanceof ModelANotInstalledError ||
      (APICallError.isInstance(err) && !err.isRetryable)
    ) {
      console.warn(JSON.stringify({ event: "level-generator-error", jobId, repo, sha, level, error: String(err) }));
      await failJob(sql, jobId, `${stepId}-failed`);
      return { status: "failed", reason: `${stepId}-failed` } as const;
    }
    // Inngest retries this step alone; the step id in the message lets onFailure name the level.
    throw new Error(`${stepId}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
}

export function ladderGenerateFunction(inngest: Inngest, deps: Deps) {
  return inngest.createFunction(
    {
      id: "ladder-generate",
      retries: 3,
      triggers: { event: LADDER_GENERATE_EVENT },
      // After the last retry of a transient error: the job must not stay "running" forever.
      onFailure: async ({ event, error }) => {
        const data = eventData(event.data.event.data);
        const [job] = await deps.sql`SELECT status FROM generation_jobs WHERE id = ${data.jobId}`;
        const inReader = job?.status === "fetched" || job?.status === "picking";
        const inMapper = job?.status === "picked" || job?.status === "mapping";
        const inChunks = job?.status === "mapped";
        const inLevel = LEVEL_STEP.exec(error?.message ?? "")?.[0];
        await failJob(
          deps.sql,
          data.jobId,
          inLevel
            ? `${inLevel}-failed`
            : inReader
              ? "reader-error"
              : inMapper
                ? "mapper-error"
                : inChunks
                  ? "embedder-error"
                  : "github-error",
        );
      },
    },
    async ({ event, step }) => {
      const data = eventData(event.data);
      const fetched = await step.run("fetch-repo", () => fetchRepo(deps, data));
      if (fetched.status !== "fetched") return fetched;
      const picked = await step.run(PICK_CORE_FILES_STEP, () => pickCoreFilesStep(deps, data));
      if (picked.status !== "picked") return picked;
      const mapped = await step.run(MAP_CONCEPTS_STEP, () => mapConceptsStep(deps, data));
      const { embedder } = deps;
      if (mapped.status !== "mapped" || !embedder) return mapped;
      const chunked = await step.run(CHUNK_AND_EMBED_STEP, () => chunkAndEmbedStep({ ...deps, embedder }, data));
      if (chunked.status !== "chunked") return chunked;
      const concepts = mapped.concepts.map((c: { name: string; reason: string }) => ({
        name: c.name,
        reason: c.reason,
      }));
      // AC 2: one generator step per level, in parallel; a concept-only ladder (AC 8) generates L0 only.
      const levels = await Promise.all(
        LEVEL_IDS.map((level) =>
          mapped.fallbackToConcepts && level !== "L0"
            ? ({ level, status: "skipped", kind: "concept-only-skipped" } as const)
            : step.run(generateLevelStepId(level), () => generateLevelStep(deps, data, level, concepts)),
        ),
      );
      // A level that ran after another level failed the job answers job-failed: report the level that failed it.
      const failed =
        levels.find((l) => l.status === "failed" && l.reason !== "job-failed") ??
        levels.find((l) => l.status === "failed");
      if (failed) return failed;
      return { ...mapped, chunks: chunked.chunks, levels };
    },
  );
}
