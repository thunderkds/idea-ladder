// T030: the pure parts of the pass-test screens. Which screen a level uses, every server code in plain words (one
// place for new codes), the review-cards link, and the diff-question poll rules. The client scores nothing: it only
// shows what the T012-T014 handlers return.
import { LEVEL_IDS, type LevelId } from "../shared/levels.ts";

export type TestKind = "mcq" | "branch" | "repo-or-pr";

/** L0, L1 (T013 option B: MCQs on setup) and L3 are MCQ tests; L2 is a branch link; L4 a repo or PR link. */
export function testKind(level: string): TestKind {
  if (level === "L2") return "branch";
  if (level === "L4") return "repo-or-pr";
  return "mcq";
}

/** The level of a test screen URL (`/ladders/:id?test=L3`), or undefined when it is not one of L0-L4. */
export function testLevelFromSearch(search: string): LevelId | undefined {
  const level = new URLSearchParams(search).get("test");
  return LEVEL_IDS.find((id) => id === level);
}

/** Plain-words local time for a server ISO time. */
export const localTime = (iso: string) => new Date(iso).toLocaleString();

const GENERIC = "Something went wrong. Try again in a few minutes.";

const MCQ_PROBLEMS: Record<string, string> = {
  "pool-too-small": "This level's test is not ready yet",
  "attempt-expired": "This attempt expired",
  "already-submitted": "Already submitted",
  "not-found": "Pass the previous level first",
};

/** T012 error codes of startMcqAttempt / submitMcqAttempt (429 is shown with its `retryAt`, see the screen). */
export function mcqProblemText(error: string): string {
  return MCQ_PROBLEMS[error] ?? GENERIC;
}

const ARTIFACT_REASONS: Record<string, string> = {
  "author-mismatch": "These commits are not by your GitHub account",
  "pr-not-merged": "This PR is not merged yet",
  "not-found": "GitHub has no public repo, branch or PR at this link",
  "no-new-commits": "This has no new commits of yours after the ladder's pinned commit",
  "not-from-scratch": "This repo is a fork of the ladder's repo. Send a PR link, or a repo you built from scratch",
  "range-too-large": "This branch has more than 250 new commits. Send a branch with one small change",
  "wrong-repo": "This is not the ladder's repo or a fork of it",
};

const URL_EXAMPLE: Record<string, string> = {
  L2: "https://github.com/you/repo/tree/your-branch",
  L4: "https://github.com/you/repo or https://github.com/owner/repo/pull/12",
};

export type ArtifactProblem = { error: string; reason?: string; retryAt?: string };

/** T013 artifact problems (verifyL2Branch / verifyL4Artifact) in plain words. */
export function artifactProblemText(p: ArtifactProblem, level: string, retryAt: string): string {
  if (p.error === "artifact-rejected") return ARTIFACT_REASONS[p.reason ?? ""] ?? GENERIC;
  if (p.error === "invalid-url") return `This is not a link of the right kind. Use a link like ${URL_EXAMPLE[level]}`;
  if (p.error === "rate-limited") return `GitHub is busy. Try again after ${localTime(p.retryAt ?? retryAt)}.`;
  if (p.error === "github-unavailable") return "Could not reach GitHub. Try again in a few minutes.";
  if (p.error === "queue-unavailable")
    return "Your branch is checked, but the questions could not be started. Try again in a few minutes.";
  if (p.error === "not-found") return "Pass the previous level first";
  return GENERIC;
}

const RUN_FEEDBACK_PROBLEMS: Record<string, string> = {
  "explanation-not-3-sentences": "Write exactly 3 sentences, each ending with . ! or ?",
  "explanation-too-long": "The explanation can have at most 600 characters.",
  "run-log-too-long": "The run log can have at most 20,000 characters.",
};

/** T013 AC 6 run-feedback problems (L1, feedback only). */
export function runFeedbackProblemText(error: string): string {
  return RUN_FEEDBACK_PROBLEMS[error] ?? GENERIC;
}

/** T014 status texts for the diff-question screen (status values from the T014 guide). */
export const DIFF_STATUS_TEXT: Record<string, string> = {
  generating: "Making 5 questions on your code",
  "diff-questions-unavailable": "We could not make 5 checked questions from this branch",
  "diff-not-testable": "This branch has no code change we can ask about",
};

/**
 * T014 routes (real since T014 merged, src/server/app.ts): GET status -> { status, reason?, setId?, questions? };
 * POST the same path -> a retake (202 { status: "generating", setId }, 409 retake-not-allowed, 429 with retryAt);
 * POST submit { answers } -> T012's result shape (src/server/diff-answers.ts).
 */
export const diffStatusPath = (artifactId: string) => `/api/artifacts/${encodeURIComponent(artifactId)}/diff-questions`;
export const diffSubmitPath = (setId: string) => `/api/diff-question-sets/${encodeURIComponent(setId)}/submit`;

const DIFF_SUBMIT_PROBLEMS: Record<string, string> = {
  "already-submitted": "Already submitted",
  "not-ready": "These questions are not ready yet. Wait a moment, then submit again.",
};

/** T014 submitDiffAnswers problems, shown next to the 5 questions (which stay on screen). */
export function diffSubmitProblemText(error: string): string {
  return DIFF_SUBMIT_PROBLEMS[error] ?? GENERIC;
}

const DIFF_RETAKE_PROBLEMS: Record<string, string> = {
  "retake-not-allowed": "New questions are not allowed for this branch now. Submit another branch instead.",
  "queue-unavailable": "The new questions could not be started. Try again in a few minutes.",
};

/** T014 retake problems (429 is shown with its `retryAt`, see the screen). */
export function diffRetakeProblemText(error: string): string {
  return DIFF_RETAKE_PROBLEMS[error] ?? GENERIC;
}

export const REVIEW_CARDS_PARAM = "cards";
const CARD_ID = /^[1-9][0-9]{0,17}$/;

/** The T011 review screen, filtered to the review cards the server linked to a failed test. */
export const reviewCardsHref = (cardIds: readonly string[]) => `/review?${REVIEW_CARDS_PARAM}=${cardIds.join(",")}`;

/** The card ids of a filtered review (`/review?cards=1,2`), or undefined for the full queue. */
export function reviewCardsFilter(search: string): Set<string> | undefined {
  const raw = new URLSearchParams(search).get(REVIEW_CARDS_PARAM);
  if (raw === null) return undefined;
  return new Set(raw.split(",").filter((id) => CARD_ID.test(id)));
}

/** The T014 status is polled at a fixed 5 s interval. */
export const DIFF_POLL_MS = 5_000;
/** After 10 min still `generating`, polling stops: "Taking longer than usual" and `Check again`. */
export const DIFF_SLOW_MS = 10 * 60_000;

/** What the diff-question screen does after a status: poll again, pause while hidden, stop, or stop as slow. */
export function diffPollStep(s: {
  status: string;
  elapsedMs: number;
  hidden: boolean;
}): "poll" | "pause" | "stop" | "slow" {
  if (s.status !== "generating") return "stop";
  if (s.elapsedMs >= DIFF_SLOW_MS) return "slow";
  return s.hidden ? "pause" : "poll";
}
