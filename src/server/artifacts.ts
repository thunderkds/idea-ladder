// T013: code-only artifact verifiers. verifyL2Branch checks a learner's L2 branch; verifyL4Artifact (below) a repo or
// merged PR. Identity is the GitHub numeric id of the signed-in account (users.github_id), never an email or login.
// Calls GitHub with the app's own token (the injected client). Never calls an LLM.
import type { SQL } from "bun";
import { LEVEL_IDS, levelLockState } from "../shared/levels.ts";
import { parseBranchUrl } from "./artifact-url.ts";
import { GitHubError, type GithubRepoClient, RateLimitError } from "./github-repo.ts";
import type { PassedLevels } from "./ladder-view.ts";

/** Sent once an L2 branch is verified; T014 consumes it (diff questions read the diff at baseSha...headSha). */
export const L2_ARTIFACT_EVENT = "ladder/l2-artifact.verified";
export type L2ArtifactVerified = {
  artifactId: string;
  learnerId: string;
  ladderId: string;
  /** owner/name of the repo holding the branch (the ladder repo or a fork of it). */
  repo: string;
  /** The ladder's pinned commit. */
  baseSha: string;
  /** The branch head at verification time: the proof (a later force-push does not change it). */
  headSha: string;
};
/** `id` makes a re-send after a failure (or a resubmission) one Inngest event. */
export type ArtifactEvent = { id: string; name: typeof L2_ARTIFACT_EVENT; data: L2ArtifactVerified };
export type EmitArtifact = (event: ArtifactEvent) => Promise<void>;

/** An L2 change is "one small feature": a longer compare range is rejected. */
export const MAX_L2_COMMITS = 250;

export type ArtifactReason =
  | "author-mismatch"
  | "pr-not-merged"
  | "not-found"
  | "no-new-commits"
  | "range-too-large"
  | "not-from-scratch"
  | "wrong-repo";
export type ArtifactProblem =
  | { status: 400; error: "invalid-url" }
  | { status: 404; error: "not-found" }
  | { status: 422; error: "artifact-rejected"; reason: ArtifactReason }
  | { status: 502; error: "github-unavailable" }
  | { status: 503; error: "rate-limited"; retryAt: string }
  | { status: 503; error: "queue-unavailable" };
export type Artifact = {
  id: string;
  level: "L2" | "L4";
  kind: "branch" | "repo" | "pr";
  url: string;
  repo: string;
  headSha: string;
  verifiedAt: string;
};

export type ArtifactDeps = {
  sql: SQL;
  github: GithubRepoClient;
  passedLevels: PassedLevels;
  emit: EmitArtifact;
  now: () => Date;
};

const ID = /^[1-9][0-9]{0,17}$/;
const reject = (reason: ArtifactReason) => ({ status: 422, error: "artifact-rejected", reason }) as const;

/** A verification failure GitHub caused, as a problem; anything else is re-thrown (500). */
function githubProblem(err: unknown): ArtifactProblem {
  if (err instanceof RateLimitError) return { status: 503, error: "rate-limited", retryAt: err.resetAt.toISOString() };
  if (err instanceof GitHubError) {
    console.warn("artifact check: GitHub call failed:", err.message);
    return { status: 502, error: "github-unavailable" };
  }
  throw err;
}

type Context = { githubId: number; login: string; repo: string; sha: string };

/** The learner's GitHub identity and the ladder's repo + SHA, when the ladder exists and `level` is not locked. */
async function levelContext(deps: ArtifactDeps, userId: string, ladderId: string, level: string) {
  if (!ID.test(ladderId)) return undefined;
  const [row] = await deps.sql`
    SELECT u.github_id::text AS github_id, u.github_login, l.repo_full_name, l.commit_sha
    FROM users u, ladders l WHERE u.id = ${userId} AND l.id = ${ladderId}`;
  if (!row) return undefined;
  const i = LEVEL_IDS.indexOf(level as (typeof LEVEL_IDS)[number]);
  if (levelLockState(await deps.passedLevels(ladderId, userId))[i] === "locked") return undefined;
  return { githubId: Number(row.github_id), login: row.github_login, repo: row.repo_full_name, sha: row.commit_sha };
}

type NewArtifact = Omit<Artifact, "id" | "verifiedAt">;

/** Inserts the artifact row (one per learner + ladder + level + url + head SHA) or returns the stored one. */
async function storeArtifact(tx: SQL, userId: string, ladderId: string, a: NewArtifact, at: Date): Promise<Artifact> {
  const [row] = await tx`
    INSERT INTO artifacts (learner_id, ladder_id, level, kind, url, repo_full_name, head_sha, verified_at)
    VALUES (${userId}, ${ladderId}, ${a.level}, ${a.kind}, ${a.url}, ${a.repo}, ${a.headSha}, ${at})
    ON CONFLICT (learner_id, ladder_id, level, url, head_sha) DO UPDATE SET url = EXCLUDED.url
    RETURNING id::text AS id, verified_at`;
  return { id: row.id, ...a, verifiedAt: new Date(row.verified_at).toISOString() };
}

/**
 * AC 1, 2, 4: passes iff the branch exists; its repo is the ladder repo or a fork of it (by repo id); the compare
 * range `pinned SHA...branch head` has 1 to MAX_L2_COMMITS commits and a non-empty diff; and every commit in it is
 * authored by the learner's GitHub id. A pass stores the artifact row and sends L2_ARTIFACT_EVENT. It writes no
 * evidence record and unlocks nothing: L2 passes with the diff questions (T014).
 */
export async function verifyL2Branch(
  deps: ArtifactDeps,
  userId: string,
  ladderId: string,
  branchUrl: unknown,
): Promise<{ artifact: Artifact } | ArtifactProblem> {
  const ref = parseBranchUrl(branchUrl);
  if (!ref) return { status: 400, error: "invalid-url" };
  const ctx: Context | undefined = await levelContext(deps, userId, ladderId, "L2");
  if (!ctx) return { status: 404, error: "not-found" };

  let found: NewArtifact;
  try {
    const { github } = deps;
    const ladderRepo = await github.getRepo(ctx.repo);
    const repo = await github.getRepo(`${ref.owner}/${ref.name}`);
    if (!ladderRepo || !repo || repo.private) return reject("not-found");
    if (repo.id !== ladderRepo.id && repo.parentId !== ladderRepo.id) return reject("wrong-repo");
    const head = await github.getBranchHead(repo.fullName, ref.branch);
    if (!head) return reject("not-found");
    const range = await github.compare(repo.fullName, ctx.sha, head, MAX_L2_COMMITS);
    if (!range) return reject("not-found");
    if (range.tooLarge) return reject("range-too-large");
    if (range.totalCommits === 0 || range.files === 0) return reject("no-new-commits");
    if (range.authorIds.some((id) => id !== ctx.githubId)) return reject("author-mismatch");
    found = { level: "L2", kind: "branch", url: ref.url, repo: repo.fullName, headSha: head };
  } catch (err) {
    return githubProblem(err);
  }

  const artifact = await storeArtifact(deps.sql, userId, ladderId, found, deps.now());
  const data = {
    artifactId: artifact.id,
    learnerId: userId,
    ladderId,
    repo: artifact.repo,
    baseSha: ctx.sha,
    headSha: artifact.headSha,
  };
  try {
    await deps.emit({ id: `l2-artifact-${artifact.id}`, name: L2_ARTIFACT_EVENT, data });
  } catch (err) {
    console.warn("artifact check: could not send", L2_ARTIFACT_EVENT, err instanceof Error ? err.message : err);
    return { status: 503, error: "queue-unavailable" };
  }
  return { artifact };
}
