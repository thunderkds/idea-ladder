// Background ladder generation (Inngest). T005 ships one step, fetch-repo; later tasks append steps after it.
import type { SQL } from "bun";
import { Inngest, NonRetriableError } from "inngest";
import { confidenceScore } from "./confidence.ts";
import { GitHubError, type GithubRepoClient, RateLimitError, RepoNotFoundError } from "./github-repo.ts";

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
    WHERE id = ${jobId} AND status IN ('queued', 'running')`;
}

type Deps = { sql: SQL; github: GithubRepoClient };

/** Reads the repo at the pinned SHA, scores confidence, stores both; all-or-nothing. Throws only to be retried. */
async function fetchRepo({ sql, github }: Deps, { repo, sha, jobId }: GenerateRequested) {
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

export function ladderGenerateFunction(inngest: Inngest, deps: Deps) {
  return inngest.createFunction(
    {
      id: "ladder-generate",
      retries: 3,
      triggers: { event: LADDER_GENERATE_EVENT },
      // After the last retry of a transient error: the job must not stay "running" forever.
      onFailure: async ({ event }) => {
        const data = eventData(event.data.event.data);
        await failJob(deps.sql, data.jobId, "github-error");
      },
    },
    async ({ event, step }) => {
      const data = eventData(event.data);
      return step.run("fetch-repo", () => fetchRepo(deps, data));
    },
  );
}
