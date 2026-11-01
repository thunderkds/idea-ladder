# TASK_GUIDE — T012: MCQ pass test — score vs stored keys, randomized pool, rate-limited retakes, append-only evidence record + SHA-256
**Date**: 2026-11-01
**Complexity Level**: C2
**Risk Level**: High
**Priority**: P0
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
6. C2: read `memory/codebase-map.md` (the app layout set by T003). Read `docs/REQUIREMENT_SOURCE.md` § Proof architecture, § LLM strategy, § Repo to ladder engine (level table), § Diagram text "Evidence record example" and "Sequence: pass test and proof"; `docs/MAIN_FLOW.md` § 4; `experiments/core-spike/RESULTS.md` § 2.

---

## Requirement (Pillar 1 — Adapt the requirement)

Source (`docs/REQUIREMENT_SOURCE.md`):
- § Proof architecture: "Verifiers (code only) — MCQ: score against verified keys." "Evidence record — One append-only record per level passed, with a SHA-256 hash of its contents — Postgres." "Anti-cheat: ... MCQs are drawn from a randomized pool; retakes are rate-limited; artifacts must match the signed-in GitHub account."
- § Repo to ladder engine: "L3 Understand — Verified MCQs on core files; AI feedback on explanation (not a gate)"; "L0 Prerequisites — Concept ladder tests".
- § LLM strategy: "The LLM generates practice and questions; it never explains the repo and never decides a pass." "gate only on verified MCQs or GitHub-checked artifacts."
- § Sequence: pass test and proof: "score with stored keys (code, no LLM)" → "evidence record + SHA-256 hash" → "L3 unlocked (fail: back to review cards)".
- Evidence record example: `{"learner":"github:thunderkds","ladder":"repo:owner/name@3f2a9c1","level":"L2","test":"artifact+diff-questions", ... "verifiedBy":"verifier@1.3.0","verifiedAt":"2026-11-01T09:12:00Z","hash":"sha256:..."}`.
- T001 result: canonical JSON + SHA-256 kept (17/17 tamper cases rejected).

**Restated intent** (Supervisor's interpretation):
> A learner takes a level's MCQ pass test: the server draws a random set from that level's verified question pool, scores the answers against the stored keys in code, and unlocks the next level on a pass. Each pass writes one append-only evidence record whose SHA-256 hash covers its canonical JSON; retakes are rate-limited and no LLM touches the decision.

**Out of scope** (what this task explicitly does NOT do):
- Test-taking screen UI: the test-taking screen is T030. This task exposes the server handlers only.
- GitHub artifact verifiers (T013), diff questions (T014), the L1 pass test (T013 decision).
- Signing and credentials (T019); evidence records here carry a hash, not a signature.
- AI feedback on the L3 explanation (feedback only; not built here).
- The question flag (T016).

**Requirement Refs** (FR/NFR/US IDs from `PRD.md` this task satisfies):
- US-003: a level unlocks only after its test is passed
- FR-007: level unlock is deterministic code
- FR-010: MCQ scored against stored keys (MCQ part)
- FR-011: one append-only evidence record per passed level, SHA-256 hash
- FR-016: randomized pool; rate-limited retakes
- NFR-002: the LLM is never in the trust path

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [ ] Restated intent confirmed to match the user's request (by Supervisor / user — not the implementing agent)
- [ ] Domain terms align with `PROJECT_SPEC.md` glossary (`grill-with-docs` run if terminology was fuzzy)
- [ ] Every Acceptance Criterion below traces to a line in the Requirement
- [ ] All Requirement Refs exist in `PRD.md` and are fully covered by the Acceptance Criteria above

> An agent must NOT start implementing until this gate is checked. If anything here is unclear,
> STOP and ask the Supervisor (Karpathy: Think Before Coding).

---

## Dependencies & Reachability

**Depends on**: T008 — stored MCQs with answer keys and a verification status per question; T011 — the review cards a failed test points back to, and the learner's level lock state.
**Entry point**: `startMcqAttempt` and `submitMcqAttempt` (server handlers; route paths follow the app layout set by T003)

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | `startMcqAttempt(learner, level)` draws `MCQ_TEST_SIZE = 10` distinct questions at random from the level's pool of questions with status `verified` only, shuffles each question's options, stores the attempt (question ids, option order, `started_at`), and returns questions and options **without keys**. A pool with fewer than 10 verified questions → error `pool-too-small`; no attempt is created. | "MCQs are drawn from a randomized pool"; "score against verified keys" |
| 2 | `submitMcqAttempt(attemptId, answers)` scores in code against the stored keys: pass iff correct ≥ `MCQ_PASS_MIN = 8` of 10. Answers for question ids not in the attempt, a second submit of the same attempt, or a submit after `MCQ_ATTEMPT_TTL = 30 min` → rejected, attempt unchanged. | "score with stored keys (code, no LLM)" |
| 3 | A pass unlocks the next level for that learner in the same database transaction that writes the evidence record. A fail unlocks nothing and returns the ids of the review cards linked to the missed questions ("back to review cards"). | "L3 unlocked (fail: back to review cards)"; US-003 |
| 4 | A pass writes exactly one evidence record per learner + ladder + level, shaped like the source example: `{ learner: "github:<login>", ladder: "repo:<owner/name>@<sha7>", level, test: "mcq", evidence: { asked, correct, pass, questionIds }, verifiedBy: "verifier@<app version>", verifiedAt, hash }`. `hash = "sha256:" + hex(SHA-256(canonicalJson(record without hash)))`. A second pass of the same level writes no second record. | FR-011; evidence record example |
| 5 | The evidence table is append-only: UPDATE and DELETE are rejected by the database (trigger), not only by app code. Recomputing the hash of any stored record equals its stored `hash`. | "One append-only record per level passed" |
| 6 | Retakes are rate-limited: at most `MCQ_ATTEMPTS_PER_DAY = 3` started attempts per learner per level per rolling 24 h; the 4th → HTTP 429 with the time the next attempt is allowed. A retake avoids questions of the previous attempt when the pool has ≥ 20 verified questions. | "retakes are rate-limited" |
| 7 | No LLM call is reachable from `startMcqAttempt` or `submitMcqAttempt` (test: the AI SDK client is mocked to throw; both pass). A level that is locked for the learner, or another learner's attempt id → 404. | NFR-002; FR-007 |

---

## Evaluation & Acceptance (How we know the agent worked correctly)

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | Level with 12 verified + 5 unverified questions | attempt holds 10 questions, all verified; response JSON has no `key` field at any depth | integration test |
| 2 | Answers with 8 correct; then a separate attempt with 7 correct | pass + next level unlocked + 1 evidence record; fail + 0 records + review card ids | integration test |
| 3 | Stored evidence record with keys in another order | recomputed hash equals stored `hash`; changing `level` gives another hash | vitest (canonical JSON) |
| 4 | `UPDATE evidence_record SET level = 'L4'` | database error; row unchanged | integration test |
| 5 | 4th attempt start within 24 h | 429 with `retryAt` | integration test with fake clock |
| 6 | Submit at `started_at + 31 min`; second submit; answer for a foreign question id | each rejected; attempt and evidence unchanged | integration test |
| 7 | Level with 9 verified questions | `pool-too-small`; no attempt row | integration test |

### Verification Command (exact, runnable)

```bash
# describe blocks of this task start with "T012"
pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test -- -t "T012"
```

### Evidence (filled by reviewer at Stage 4/5)

> **Moved.** Filled by the reviewer at Stage 4/5 in `tasks/TASK_REVIEW_T012.md`.

---

## Demonstration

> **Moved.** See `tasks/TASK_REVIEW_T012.md`.

---

## Approach

**Pattern reference**: `experiments/core-spike/src/proof.ts` — `canonicalJson` (sorted keys, NFC strings, no insignificant whitespace) and `hashRecord` (hash input excludes `hash` and `signature`); port both into the app's server code with their tests, do not import from `experiments/`. For server handlers and DB access, imitate the handlers of T005/T011.

**Vital slice**: score against stored keys → one hashed, append-only evidence record → next level unlocked, in one transaction.
**Cut list**:
- signature on the evidence record (T019 signs the credential)
- adaptive test length or per-level thresholds (fixed constants)
- question difficulty weighting
- partial credit

Constants `MCQ_TEST_SIZE = 10`, `MCQ_PASS_MIN = 8` (80%, the same ratio as the diff-question threshold 4 of 5 in the source's evidence example), `MCQ_ATTEMPTS_PER_DAY = 3` and `MCQ_ATTEMPT_TTL = 30 min` are Supervisor choices; the source sets no MCQ numbers. Keep them in one config module. Use `crypto.randomInt` for the draw and the shuffle (Fisher–Yates), not `Math.random`. Keys stay in the database; the attempt row stores the option order so scoring maps the learner's choice back to the stored option. `verifiedBy` = `verifier@` + the app version from `package.json`. Write the migration (attempt table, evidence table, append-only trigger, unique `(learner, ladder, level)` on evidence); it must pass `Skill({ skill: "migration-safety" })` and Common-Infrastructure applies it.

---

## Edge Case Checklist

- [ ] Two concurrent submits of one attempt → exactly one is scored (row lock or `submitted_at IS NULL` guard)
- [ ] Two concurrent passes of one level (two attempts) → unique constraint keeps one evidence record; the second returns the existing record
- [ ] A question's status changes to removed (T016) during an attempt → the attempt is still scored on its stored questions
- [ ] Learner answers with the option text instead of the option index, or an index out of range → rejected as invalid input
- [ ] Unicode in learner login or ladder name → NFC before hashing (T001 edge case)
- [ ] Ladder pinned SHA shorter than 7 chars is impossible; `ladder` uses the first 7 hex chars of the pinned 40-hex SHA
- [ ] Rate-limit window counts started attempts, including abandoned ones
- [ ] Clock: `verifiedAt` is server UTC ISO-8601 with `Z`

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| MCQ attempt module with `startMcqAttempt` / `submitMcqAttempt` (server code area set by T003) | new |
| evidence module with `canonicalJson`, `hashRecord`, `writeEvidenceRecord` | new; T013/T014/T019 reuse it |
| pass-test config module | new: the 4 constants |
| new migration (migrations folder set by T003) | attempt table, evidence table, append-only trigger, unique index |
| tests (vitest + test Postgres) | AC 1–7 |
| `tasks/TASK_REVIEW_T012.md` | Evidence (reviewer) |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `.claude/**`, `agents/**`, `skills/**`, `templates/**`, `AGENTS.md`, `CLAUDE.md` | kit |
| `PRD.md`, `PROJECT_SPEC.md`, `PROJECT_KANBAN.md` | Supervisor-owned |
| `experiments/**` | spike code is a pattern reference only; do not import or edit |
| generator and blind-solver code (T008, T009) | read the question status only |
| applied migrations of earlier tasks | add a new migration instead |

---

## Test Plan

Unit (vitest): canonical JSON and hash (key order, NFC/NFD, excluded `hash`), scoring arithmetic, rate-limit window with a fake clock. Integration (vitest + test Postgres): full attempt → pass → unlock → evidence; fail path; append-only trigger; concurrency guards with two parallel submits; LLM client mocked to throw. Paste `pnpm test` output into the report.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run
- [ ] Security review: `Skill({ skill: "security-review" })` run (High risk)
- [ ] `Skill({ skill: "migration-safety" })` passed for the new migration
- [ ] Lint passes (`pnpm lint`, `pnpm typecheck`)
- [ ] Tests written AND pass — output pasted into `tasks/TASK_REVIEW_T012.md` Evidence (Hard-Stop Gate 5)
- [ ] `Skill({ skill: "verify" })` run — headless auto verify
- [ ] Supervisor notified: task ready for Stage 4 review
