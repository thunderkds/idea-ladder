// T030: the pure parts of the pass-test screens — which screen a level uses, server codes in plain words, and the
// diff-question poll rules. No DOM, no network.
import { describe, expect, test } from "bun:test";
import {
  artifactProblemText,
  DIFF_POLL_MS,
  DIFF_SLOW_MS,
  diffPollStep,
  diffRetakeProblemText,
  diffSubmitProblemText,
  mcqProblemText,
  REVIEW_CARDS_PARAM,
  reviewCardsFilter,
  reviewCardsHref,
  testKind,
  testLevelFromSearch,
} from "../src/client/pass-test.ts";

describe("T030 pass-test kind per level", () => {
  test("L0, L1 and L3 use the MCQ screen (L1 is T013 option B); L2 a branch link; L4 a repo or PR link", () => {
    expect(["L0", "L1", "L2", "L3", "L4"].map(testKind)).toEqual(["mcq", "mcq", "branch", "mcq", "repo-or-pr"]);
  });

  test("?test= accepts only L0-L4", () => {
    expect(testLevelFromSearch("?test=L3")).toBe("L3");
    expect(testLevelFromSearch("?test=L5")).toBeUndefined();
    expect(testLevelFromSearch("?test=l3")).toBeUndefined();
    expect(testLevelFromSearch("?test=L3x")).toBeUndefined();
    expect(testLevelFromSearch("")).toBeUndefined();
  });
});

describe("T030 reason codes in plain words", () => {
  test("every T013 reason code has its own text; the AC 3 wordings are exact", () => {
    const at = "2030-01-01T12:00:00.000Z";
    const reasons = [
      "author-mismatch",
      "pr-not-merged",
      "not-found",
      "no-new-commits",
      "not-from-scratch",
      "range-too-large",
      "wrong-repo",
    ];
    const texts = reasons.map((reason) => artifactProblemText({ error: "artifact-rejected", reason }, "L2", at));
    expect(new Set(texts).size).toBe(reasons.length);
    expect(texts[0]).toBe("These commits are not by your GitHub account");
    expect(texts[1]).toBe("This PR is not merged yet");
    expect(artifactProblemText({ error: "invalid-url" }, "L2", at)).toContain("https://github.com/you/repo/tree/");
    expect(artifactProblemText({ error: "invalid-url" }, "L4", at)).toContain("/pull/");
    expect(artifactProblemText({ error: "rate-limited", retryAt: at }, "L2", at)).toContain(
      new Date(at).toLocaleString(),
    );
  });

  test("an unknown code gets a generic text, never the raw code", () => {
    const text = artifactProblemText({ error: "artifact-rejected", reason: "brand-new-code" }, "L4", "");
    expect(text).not.toContain("brand-new-code");
    expect(text.length).toBeGreaterThan(0);
    expect(mcqProblemText("brand-new-code")).not.toContain("brand-new-code");
  });

  test("MCQ problems: pool-too-small, expired, already submitted (AC 5 wordings)", () => {
    expect(mcqProblemText("pool-too-small")).toBe("This level's test is not ready yet");
    expect(mcqProblemText("attempt-expired")).toBe("This attempt expired");
    expect(mcqProblemText("already-submitted")).toBe("Already submitted");
  });
});

describe("T030 review cards link", () => {
  test("the result view links to /review filtered to the server's card ids; the review page reads them back", () => {
    expect(reviewCardsHref(["11", "12", "13"])).toBe(`/review?${REVIEW_CARDS_PARAM}=11,12,13`);
    expect([...(reviewCardsFilter("?cards=11,12,13") ?? [])]).toEqual(["11", "12", "13"]);
    expect(reviewCardsFilter("")).toBeUndefined();
    // Only ids: anything else in the list is dropped.
    expect([...(reviewCardsFilter("?cards=11,x,<b>,12") ?? [])]).toEqual(["11", "12"]);
  });
});

describe("T030 diff-question poll rules", () => {
  test("polls every 5 s while generating; a final status stops; a hidden page pauses", () => {
    expect(DIFF_POLL_MS).toBe(5_000);
    expect(diffPollStep({ status: "generating", elapsedMs: 0, hidden: false })).toBe("poll");
    expect(diffPollStep({ status: "generating", elapsedMs: 0, hidden: true })).toBe("pause");
    for (const status of ["ready", "diff-questions-unavailable", "diff-not-testable", "passed", "failed"])
      expect(diffPollStep({ status, elapsedMs: 0, hidden: false })).toBe("stop");
  });

  test("after 10 min of generating, polling stops as slow (Taking longer than usual)", () => {
    expect(DIFF_SLOW_MS).toBe(600_000);
    expect(diffPollStep({ status: "generating", elapsedMs: DIFF_SLOW_MS - 1, hidden: false })).toBe("poll");
    expect(diffPollStep({ status: "generating", elapsedMs: DIFF_SLOW_MS, hidden: false })).toBe("slow");
  });
});

describe("T030 diff submit and retake problems in plain words (T014 codes)", () => {
  test("a failed diff submit keeps a plain-words reason, never the raw code", () => {
    expect(diffSubmitProblemText("already-submitted")).toBe("Already submitted");
    expect(diffSubmitProblemText("not-ready")).toContain("not ready");
    for (const code of ["unknown-question", "invalid-request", "brand-new-code"])
      expect(diffSubmitProblemText(code)).not.toContain(code);
  });

  test("a refused retake: 409 retake-not-allowed and 503 queue-unavailable in words", () => {
    expect(diffRetakeProblemText("retake-not-allowed")).toContain("Submit another branch");
    expect(diffRetakeProblemText("queue-unavailable")).toContain("Try again in a few minutes");
    expect(diffRetakeProblemText("brand-new-code")).not.toContain("brand-new-code");
  });
});
