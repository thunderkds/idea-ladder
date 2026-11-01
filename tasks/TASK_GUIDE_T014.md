# TASK_GUIDE — T014: Diff questions after L2 — generated from the learner's diff (model A), blind-solved (model B), pass 4 of 5
**Date**: 2026-11-01
**Complexity Level**: C2
**Risk Level**: High
**Priority**: P1
**Assigned agent**: backend-developer
**Agent guide**: `agents/backend.md`

---

## Mandatory Startup (Do Not Skip)

Before writing any code:
1. Read `PROJECT_SPEC.md`
2. Read the memory slice in your spawn prompt (`<!-- memory-slice -->`). Read `memory/MEMORY.md` in full only if your work reaches a file, hook, skill or decision the slice does not cover
3. Read this file completely
4. Read `agents/backend.md`
5. Note the **Complexity Level** above and apply the matching process from the Complexity matrix in `agents/backend.md`
6. C2: read `memory/codebase-map.md` (the app layout set by T003). Read `docs/REQUIREMENT_SOURCE.md` § LLM strategy (row "Questions on learner's own diff", verification pipeline), § Proof architecture (anti-cheat), § Diagram text "Sequence: pass test and proof" and "Evidence record example"; `docs/MAIN_FLOW.md` § 4 and § 6; `experiments/core-spike/RESULTS.md` § 1 and Known limits.

---

## Requirement (Pillar 1 — Adapt the requirement)

Source (`docs/REQUIREMENT_SOURCE.md`):
- § LLM strategy: "Questions on learner's own diff — Yes, core feature — Generated after L2 from the learner's changes — 27% of passing students failed simple questions on their own code."
- Verification pipeline: "Generate only from retrieved chunks (README, docs, source files, learner diff)." "Code check: the answer key must appear in, or be checkable against, the cited chunk." "Second model answers the question blind; a different answer from the key means discard."
- § Sequence: pass test and proof: "questions from the diff only (A)" → "blind-solve each question (B)" → "keep only keys verified against the diff" → "push: 5 questions on your code" → "score with stored keys (code, no LLM)" → "evidence record + SHA-256 hash" → "L3 unlocked (fail: back to review cards)".
- Evidence record example: `"test":"artifact+diff-questions"`, `"diffQuestions":{"asked":5,"correct":4,"pass":4}`.
- `PRD.md` FR-009 note: "diff-question pass threshold = 4 of 5".
- § Generation pipeline: "key mismatch: regenerate, max 2". `docs/MAIN_FLOW.md` § 6: "The diff questions are blind-solved by model B too."

**Restated intent** (Supervisor's interpretation):
> After T013 verifies a learner's L2 branch, a durable workflow makes 5 questions from that diff only. Model A generates them; the code check and model B's blind solve keep only verified keys. The learner answers, code scores against the stored keys, and 4 of 5 correct passes L2: one evidence record is written and L3 unlocks.

**Out of scope** (what this task explicitly does NOT do):
- Branch / author / SHA verification (T013).
- Push notification delivery (T015); this task sets a "questions ready" status the PWA reads.
- Answer screen UI (server handlers only).
- AI grading of open answers (FR-008: feedback only, not built here).
- Choosing model B or measuring cost (T009, T017).

**Requirement Refs** (FR/NFR/US IDs from `PRD.md` this task satisfies):
- US-004: questions generated from the learner's own diff
- FR-009: diff questions after L2
- FR-006: verification pipeline (grounded chunk = diff hunk, code check, blind solve)
- FR-010: diff questions scored above threshold in code
- FR-011: evidence record for the passed L2
- NFR-002: the LLM is never in the trust path
- NFR-005: durable steps, retried alone

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [ ] Restated intent confirmed to match the user's request (by Supervisor / user — not the implementing agent)
- [ ] Domain terms align with `PROJECT_SPEC.md` glossary (`grill-with-docs` run if terminology was fuzzy)
- [ ] Every Acceptance Criterion below traces to a line in the Requirement
- [ ] All Requirement Refs exist in `PRD.md` and are fully covered by the Acceptance Criteria above

> An agent must NOT start implementing until this gate is checked. If anything here is unclear,
> STOP and ask the Supervisor (Karpathy: Think Before Coding).

---

## Dependencies & Reachability

**Depends on**: T013 — the verified L2 artifact (`headSha`, compare range) and the event it emits; T009 — the model B blind-solver step and its regenerate-max-2 loop; T012 (via T013) — `writeEvidenceRecord`, scoring pattern, retake rate limit.
**Entry point**: `generateDiffQuestions` (Inngest function triggered by the T013 L2-artifact event) and `submitDiffAnswers` (server handler)

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | `generateDiffQuestions` reads the diff at the stored compare range (`pinned SHA ... headSha`), never the branch tip. Each Inngest step (fetch diff, generate, code check, blind solve, save) is a separate `step.run`; a failure in blind solve retries that step without re-calling generation. | "questions from the diff only"; NFR-005 |
| 2 | Model A gets only diff hunks (no README, no other source) and returns MCQs through a zod schema: `{ question, options[4], key, citedHunkId }`. A question whose `citedHunkId` is not in the given hunks is discarded. | "Generate only from retrieved chunks (... learner diff)" |
| 3 | Each question passes the code check (`checkAnswerKey` ported from T001, chunk = cited hunk) and model B's blind solve (model B sees question + options, not the key or the hunk id); disagreement → discard. Missing questions are regenerated at most 2 rounds; exactly 5 verified questions are stored, keys server-side only. | code check; blind solve; "regenerate, max 2"; "5 questions on your code" |
| 4 | Boundary: fewer than 5 verified questions after 2 regenerate rounds → status `diff-questions-unavailable` with the reason, no partial set served, L2 stays open; the learner can submit another branch. A diff that is empty after removing lockfiles, binary files and generated files → `diff-not-testable` before any LLM call. | "keep only keys verified"; no partial result |
| 5 | `submitDiffAnswers` scores in code: pass iff correct ≥ `DIFF_PASS_MIN = 4` of 5. Pass → one evidence record `{ test: "artifact+diff-questions", evidence: { branch, commit: headSha, diffQuestions: { asked: 5, correct, pass: 4 } } }` through `writeEvidenceRecord`, and L3 unlocks in the same transaction. 3 of 5 → fail, no record, review cards linked. | "pass 4 of 5"; evidence record example; "L3 unlocked (fail: back to review cards)" |
| 6 | Retakes follow T012's rate limit. A retake gets a newly generated set; no question shown in an earlier attempt for this artifact is reused. Submitting answers for another learner's set, a second submit, or answers for unknown question ids → rejected, nothing stored. | FR-016 anti-cheat |
| 7 | No LLM call is reachable from `submitDiffAnswers` (AI SDK mocked to throw; scoring test passes). Tests use the AI SDK's mock language model (`ai/test`) for model A and model B; no network. | NFR-002 |

---

## Evaluation & Acceptance (How we know the agent worked correctly)

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | Recorded diff fixture (3 hunks); mock A returns 5 valid questions; mock B agrees on all | 5 stored questions, keys absent from the API response | integration test (Inngest test engine) |
| 2 | Mock A returns 1 question citing a hunk id not in the diff, mock B disagrees on 1 | 2 discarded; 1 regenerate round; 5 stored | integration test |
| 3 | Mock B disagrees on every question in all rounds | `diff-questions-unavailable` after 2 regenerate rounds; 0 questions served | integration test |
| 4 | Blind-solve step throws once, then succeeds | generation mock called once in total | integration test (call counter) |
| 5 | Answers 4 / 5 correct; then a separate set 3 / 5 | pass, evidence `diffQuestions {asked:5, correct:4, pass:4}`, L3 unlocked; fail, no record | integration test |
| 6 | Diff that changes only `pnpm-lock.yaml` | `diff-not-testable`; LLM mocks never called | integration test |

### Verification Command (exact, runnable)

```bash
# describe blocks of this task start with "T014"; models are mocks, GitHub is recorded fixtures
pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test -- -t "T014"
```

### Evidence (filled by reviewer at Stage 4/5)

> **Moved.** Filled by the reviewer at Stage 4/5 in `tasks/TASK_REVIEW_T014.md`.

---

## Demonstration

> **Moved.** See `tasks/TASK_REVIEW_T014.md`.

---

## Approach

**Pattern reference**: the generator → code check → blind-solve steps of T008/T009 (Inngest `step.run` per stage, zod schema, regenerate loop) — reuse those functions with the diff hunks as chunks instead of copying them; `experiments/core-spike/src/keycheck.ts` (via the app port from T008) for the code check; T012's `submitMcqAttempt` for code-only scoring.

**Vital slice**: diff hunks → 5 verified questions → code scoring 4 of 5 → evidence record + L3 unlock.
**Cut list**:
- open-answer questions on the diff (feedback only; not a gate)
- diff summarisation for very large diffs (cap instead)
- per-question explanations after the test
- learner choice of question count

Split the diff into hunks with stable ids (`<file path>#<hunk index>`). Cap the input at `DIFF_TOKEN_BUDGET` (a constant the agent sets from the T006 token-budget pattern); a diff above it keeps the largest code hunks first and drops the rest, and the dropped count is logged. Excluded files: lockfiles (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `Cargo.lock`, `poetry.lock`), binary diffs, paths under `dist/`, `build/`, `vendor/`. Model A is the Claude model configured by T008; model B is "model B (second provider, chosen in T009)" — read both from the shared model config, never name a model in this task's code. Status values: `generating`, `ready`, `diff-questions-unavailable`, `diff-not-testable`, `passed`, `failed`. Write the migration (diff question set + question rows); it must pass `Skill({ skill: "migration-safety" })` and Common-Infrastructure applies it.

---

## Edge Case Checklist

- [ ] Learner force-pushed after T013 → diff read at stored `headSha`; if GitHub no longer has that SHA → `diff-not-testable` with reason `sha-gone`
- [ ] Model A copies a long code line into the question → allowed (it is the learner's own code, not repo docs; NFR-006 applies to cards from repo docs); keep questions ≤ 500 chars
- [ ] Key matches lexically but only as a substring (`map` in `bitmap`) → code check rejects (T001 rule)
- [ ] Two options with the same normalised text → discard the question
- [ ] Model B returns an option text, not an index → map by normalised text; no match → disagreement
- [ ] GitHub rate limit while fetching the diff → step retries with backoff from `retryAt`; no partial set
- [ ] Same L2 artifact event delivered twice → one question set (idempotency key = artifact id)
- [ ] Diff with only deleted lines → still testable (questions about what was removed)

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| `generateDiffQuestions` Inngest function (workflow folder set by T005) | new |
| diff hunk splitter + filter module | new |
| `submitDiffAnswers` handler (server code area set by T003) | new |
| new migration (migrations folder set by T003) | diff question set and question tables |
| recorded diff fixtures; mock model setups | new |
| tests (vitest + Inngest test engine + test Postgres) | AC 1–7 |
| `tasks/TASK_REVIEW_T014.md` | Evidence (reviewer) |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `.claude/**`, `agents/**`, `skills/**`, `templates/**`, `AGENTS.md`, `CLAUDE.md` | kit |
| `PRD.md`, `PROJECT_SPEC.md`, `PROJECT_KANBAN.md` | Supervisor-owned |
| `experiments/**` | pattern reference only |
| generator, code-check and blind-solver modules of T008/T009 | call them; a needed change goes back to the Supervisor |
| evidence module (T012), artifact verifiers (T013) | consume only |
| applied migrations of earlier tasks | add a new migration instead |

---

## Test Plan

Unit (vitest): hunk splitter and filter; scoring arithmetic (5/5, 4/5, 3/5, 0/5). Integration (vitest + Inngest test engine + test Postgres, AI SDK mock models, recorded diff fixtures): every Success Criteria row and the edge cases. No live model call in the suite. One manual real run on the owner's own L2 branch (live models, keys in env) is recorded in the review with its question set — not part of CI. Paste `pnpm test` output into the report.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run
- [ ] Security review: `Skill({ skill: "security-review" })` run (High risk)
- [ ] `Skill({ skill: "migration-safety" })` passed for the new migration
- [ ] Lint passes (`pnpm lint`, `pnpm typecheck`)
- [ ] Tests written AND pass — output pasted into `tasks/TASK_REVIEW_T014.md` Evidence (Hard-Stop Gate 5)
- [ ] `Skill({ skill: "verify" })` run — headless auto verify
- [ ] Supervisor notified: task ready for Stage 4 review
