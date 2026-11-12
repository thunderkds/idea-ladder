// Background ladder generation (Inngest). Steps: fetch-repo (T005), pick-core-files (T006); later tasks append more.
import { APICallError, type LanguageModel } from "ai";
import type { SQL } from "bun";
import { Inngest, NonRetriableError } from "inngest";
import { ZodError } from "zod";
import { pickCoreFilesClaudeCode, ReaderNotInstalledError } from "./claude-code-reader.ts";
import { confidenceScore } from "./confidence.ts";
import { GitHubError, type GithubRepoClient, RateLimitError, RepoNotFoundError } from "./github-repo.ts";
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
    WHERE id = ${jobId} AND status IN ('queued', 'running', 'fetched', 'picking')`;
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
  | { backend: "claude-code"; modelId?: string; githubToken?: string; claudeBin?: string }
);
type Deps = { sql: SQL; github: GithubRepoClient; reader: ReaderDeps };

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
      // A retry cannot help these (400 prompt too long, 401 bad key, a schema bug): fail now, no paid re-run.
      if ((APICallError.isInstance(err) && !err.isRetryable) || err instanceof ZodError) {
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

export function ladderGenerateFunction(inngest: Inngest, deps: Deps) {
  return inngest.createFunction(
    {
      id: "ladder-generate",
      retries: 3,
      triggers: { event: LADDER_GENERATE_EVENT },
      // After the last retry of a transient error: the job must not stay "running" forever.
      onFailure: async ({ event }) => {
        const data = eventData(event.data.event.data);
        const [job] = await deps.sql`SELECT status FROM generation_jobs WHERE id = ${data.jobId}`;
        const inReader = job?.status === "fetched" || job?.status === "picking";
        await failJob(deps.sql, data.jobId, inReader ? "reader-error" : "github-error");
      },
    },
    async ({ event, step }) => {
      const data = eventData(event.data);
      const fetched = await step.run("fetch-repo", () => fetchRepo(deps, data));
      if (fetched.status !== "fetched") return fetched;
      return step.run(PICK_CORE_FILES_STEP, () => pickCoreFilesStep(deps, data));
    },
  );
}
