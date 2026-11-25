# TASK_GUIDE — T033: Thin MCQ pools — top up a level whose pool is below MIN_MCQ_POOL, so fewer ladders dead-end at `pool-too-small`
**Date**: 2026-11-25
**Complexity Level**: C2
**Risk Level**: Medium
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
6. C2: read `memory/codebase-map.md`. Read `tasks/TASK_GUIDE_T008.md` (level generators, check-and-dedupe, save-ladder), `tasks/TASK_GUIDE_T009.md` (blind solver) and `tasks/TASK_GUIDE_T013.md` AC 6 and its Questions Log (the T013 Stage 4 Debate that created this task).

---

## Requirement (Pillar 1 — Adapt the requirement)

Source: `PROJECT_KANBAN.md` T033, found 2026-11-19 in T013 Stage 4: "Thin MCQ pools: when a level in POOL_LEVELS (L0, L1, L3) saves fewer than MIN_MCQ_POOL questions, top it up or fall back to a concept-only ladder, so no ladder dead-ends at `pool-too-small`." Today `saveLadder` flags the level `insufficient-pool` and `startMcqAttempt` answers 422 `pool-too-small` (`src/server/mcq-test.ts`, `src/server/save-ladder.ts`: `MIN_MCQ_POOL = 8`, `POOL_LEVELS = L0, L1, L3`).

**Restated intent** (Supervisor's interpretation):
> A ladder whose L0, L1 or L3 generation kept fewer than 8 checked questions gets a bounded top-up before it is saved. Every question from the top-up passes the same answer-key code check, near-duplicate check and blind solve as the first ones. A level that still has fewer than 8 after the top-up is saved exactly as today (flag `insufficient-pool`, 422 `pool-too-small`), with no weaker check and no bypass.

**Supervisor decision (2026-11-25, flagged for the user to review):** the kanban row offers "top it up OR fall back to a concept-only ladder". This task builds the top-up only. A concept-only fallback means a level the learner can pass without a verified test. That weakens "unlock each level only by passing its test" (REQUIREMENT_SOURCE § Vision), so it needs a user decision and is cut.

**Out of scope**:
- Any change to scoring, the attempt rules or the unlock rule (T012).
- A level that stays thin after the top-up: no bypass, no lower `MIN_MCQ_POOL`, no concept-only fallback.
- Showing "not ready" in the ladder view before the learner clicks (T010/T030 UI).
- Ladders already saved (local and test databases are reset; no backfill).
- Cost logging (T017) beyond using the existing per-step cost log.
- Model or prompt changes to the first generation round.

**Requirement Refs**:
- FR-010: MCQ pools are verified by code (answer-key check) and by the blind solve
- FR-007 / NFR-002: no pass decision by a model; no weaker verification path
- US-003: a level unlocks only by passing its test

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [x] Restated intent confirmed to match the user's request (by Supervisor / user — not the implementing agent) — Supervisor 2026-11-25: user said "start all the tasks in the v1"; top-up chosen over concept-only fallback (see the decision above)
- [ ] Domain terms align with `PROJECT_SPEC.md` glossary (`grill-with-docs` run if terminology was fuzzy)
- [ ] Every Acceptance Criterion below traces to a line in the Requirement
- [ ] All Requirement Refs exist in `PRD.md` and are fully covered by the Acceptance Criteria above

> An agent must NOT start implementing until this gate is checked. If anything here is unclear,
> STOP and ask the Supervisor (Karpathy: Think Before Coding).

---

## Dependencies & Reachability

**Depends on**: T008 — generation steps and `saveLadder`; T009 — blind-solve step; T013 — L1 is in `POOL_LEVELS` (all merged).
**Entry point**: `topUpMcqPools` (the top-up step in the ladder generation workflow, `src/server/ladder-generate.ts`)

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | After the first round of check-and-dedupe and blind-solve, each level in `POOL_LEVELS` with fewer than `MIN_MCQ_POOL` kept questions gets up to `MCQ_TOP_UP_ROUNDS = 2` extra rounds. A level that already has ≥ `MIN_MCQ_POOL` gets none and costs no model call. | "top it up" |
| 2 | Each extra round asks the level generator for MCQs only, from the same grounded chunks, and tells it the questions already kept (so it does not repeat them). Its output passes the same answer-key code check, the same near-duplicate check against the kept questions, and the same blind solve as the first round. No top-up question skips any of the three. | FR-010; NFR-002 |
| 3 | Each round is its own Inngest step (`top-up-<level>-<round>`). A retry of a failed blind-solve inside a round does not call the generator again. Rounds stop as soon as the level has ≥ `MIN_MCQ_POOL`, or after `MCQ_TOP_UP_ROUNDS`. | step idempotence (T008/T009 pattern) |
| 4 | A level still below `MIN_MCQ_POOL` after the last round is saved as today: flag `insufficient-pool` in the generation report, and `startMcqAttempt` answers 422 `pool-too-small`. `MIN_MCQ_POOL` is unchanged and no code path lets a pass test run on a smaller pool. | "no bypass" (T013 Debate) |
| 5 | The generation report records, per level: top-up rounds run, questions added, questions dropped by each check. The per-step cost log has one entry per extra round. | T004/T008 report pattern |
| 6 | Boundary: a level with exactly `MIN_MCQ_POOL` - 1 kept questions that gains 1 in round 1 stops after round 1; a level that gains 0 in both rounds runs exactly 2 rounds; L2 and L4 (not in `POOL_LEVELS`) never get a top-up. | rounds and levels above |

---

## Evaluation & Acceptance (How we know the agent worked correctly)

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | Mock generator: round 0 keeps 5 L1 questions; the top-up returns 4 valid | one top-up round, L1 has 9 kept, no `insufficient-pool`, generator called once for the top-up | integration test (mock models, no network) |
| 2 | Top-up returns questions whose key is not a verbatim span, or a near-duplicate of a kept one, or that model B disagrees with | those are dropped with their reasons; they never reach the saved pool | integration test |
| 3 | Top-up gives 1 valid question per round (5 → 6 → 7) | exactly 2 rounds, L1 saved with 7 and flag `insufficient-pool`; `startMcqAttempt` gives 422 `pool-too-small` | integration test |
| 4 | Blind-solve throws once inside a top-up round | the step retries; the top-up generator mock was called once | integration test |
| 5 | A level with 8 or more kept after round 0; L2 and L4 | no extra step, no extra model call | unit test on the step plan |

### Verification Command (exact, runnable)

```bash
# describe blocks of this task start with "T033"
bun install --frozen-lockfile && bun run typecheck && bun run lint && bun test -t "T033"
```

### Evidence (filled by reviewer at Stage 4/5)

> **Moved.** Filled by the reviewer at Stage 4/5 in `tasks/TASK_REVIEW_T033.md`.

---

## Demonstration

> **Moved.** See `tasks/TASK_REVIEW_T033.md`.

---

## Approach

**Pattern reference**: `src/server/ladder-generate.ts` — the `generate-level-*`, `check-and-dedupe` and `blind-solve` steps and their step ids; imitate how each stage is its own `step.run` and how the report and cost log are filled. Reuse `checkAndDedupe` and the blind-solve step as they are; do not copy their logic.

**Vital slice**: the top-up loop for one level (L1) with the three checks, end to end through `saveLadder`. Then the same for L0 and L3 (one loop over `POOL_LEVELS`).
**Cut list**:
- concept-only fallback ladder (user decision needed; see above)
- "not ready" notice in the ladder view
- backfill of ladders saved before this task
- a different generation prompt for the top-up beyond "MCQs only, avoid these"

Build a small pure function that decides which levels need a round (`levelsNeedingTopUp(kept, round)`), so the step plan is unit-testable. The Inngest step ids must be fixed strings per level and round, because Inngest memoizes by id. Put the constant `MCQ_TOP_UP_ROUNDS` next to `MIN_MCQ_POOL`. No migration.

---

## Edge Case Checklist

- [ ] The generator returns more than needed → keep all valid ones (a bigger pool is fine); never trim below what the checks accepted
- [ ] The generator returns 0 questions or throws → the round counts as run, with 0 added; the level is saved as thin, never fails the whole job
- [ ] Top-up questions repeat a question the first round dropped as a near-duplicate → dropped again by the same check
- [ ] Round 1 and round 2 both run in one job without exceeding the job's token budget → stop and save as thin, and say so in the report
- [ ] A job retried by Inngest after `save-ladder` → no second top-up call (memoized steps)

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| `src/server/ladder-generate.ts` | top-up steps after blind-solve, before save-ladder |
| `src/server/level-generator.ts` | MCQ-only generation entry that takes the kept questions to avoid (reuse the level prompt) |
| `src/server/mcq-top-up.ts` (new) | `topUpMcqPools`, `levelsNeedingTopUp`, `MCQ_TOP_UP_ROUNDS` |
| `src/server/save-ladder.ts` | report fields for the top-up (rounds, added, dropped) |
| `tests/` (describe blocks start with "T033") | AC 1–6 |
| `tasks/TASK_REVIEW_T033.md` | Evidence (reviewer) |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `.claude/**`, `agents/**`, `skills/**`, `templates/**`, `AGENTS.md`, `CLAUDE.md` | kit |
| `PRD.md`, `PROJECT_SPEC.md`, `PROJECT_KANBAN.md` | Supervisor-owned |
| `src/server/mcq-test.ts`, `src/server/evidence.ts`, `src/server/pass-test-config.ts` | T012 scoring and attempt rules: consume only |
| `src/server/blind-solver.ts`, `src/server/answer-key-check.ts` | T009: consume only |
| `src/client/**` | UI is out of scope |
| applied migrations | this task adds no schema |

---

## Test Plan

Unit (bun test): `levelsNeedingTopUp` boundaries (AC 6, SC 5). Integration (mock models, no network, test Postgres): SC 1–4 through the real `ladderGenerateFunction` with `@inngest/test`, then a `startMcqAttempt` call on the saved ladder for SC 3. Paste output into the report.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run
- [ ] Security review: `Skill({ skill: "security-review" })` run (Medium risk)
- [ ] Lint passes (`bun run lint`, `bun run typecheck`)
- [ ] Tests written AND pass — output pasted into `tasks/TASK_REVIEW_T033.md` Evidence (Hard-Stop Gate 5)
- [ ] `Skill({ skill: "verify" })` run — headless auto verify
- [ ] Supervisor notified: task ready for Stage 4 review
