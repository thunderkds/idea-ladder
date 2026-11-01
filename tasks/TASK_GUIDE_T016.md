# TASK_GUIDE — T016: "This question seems wrong" flag; frequently flagged cards regenerated or removed
**Date**: 2026-11-01
**Complexity Level**: C1
**Risk Level**: Low
**Priority**: P2
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
6. C1: skip `memory/codebase-map.md` unless you need to find the review card component (T011) or the generator entry (T008). Read `docs/REQUIREMENT_SOURCE.md` § LLM strategy (verification pipeline, last step) and § Alternatives to investigate (row "Content source").

---

## Requirement (Pillar 1 — Adapt the requirement)

Source (`docs/REQUIREMENT_SOURCE.md`):
- § LLM strategy, verification pipeline: "Learner flag: "this question seems wrong" (same pattern AutoMCQ uses). Frequently flagged cards are regenerated or removed."
- § LLM strategy table, row "MCQs and review cards": "Grounded chunks, answer checked in source, dedupe, flag button".
- § Alternatives to investigate, row "Content source": "Switch if — Generated ladders get flagged too often".

**Restated intent** (Supervisor's interpretation):
> A learner can flag any review card or MCQ as "This question seems wrong". The flag hides that card for that learner at once. When enough distinct learners flag one card, code removes it from every pool and queue and asks the generation workflow to make a replacement from the same chunk.

**Out of scope** (what this task explicitly does NOT do):
- A moderation screen or manual review queue for flags.
- Changing a flagged question by hand.
- A per-ladder "flagged too often" alert (the flag counts are stored; the Content source switch is decided later from them).
- Flagging diff questions (T014); they are made per learner and are not shared.

**Requirement Refs** (FR/NFR/US IDs from `PRD.md` this task satisfies):
- US-008: flag a question that seems wrong, so bad cards get fixed
- FR-006: verification pipeline, learner flag step

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [ ] Restated intent confirmed to match the user's request (by Supervisor / user — not the implementing agent)
- [ ] Domain terms align with `PROJECT_SPEC.md` glossary (`grill-with-docs` run if terminology was fuzzy)
- [ ] Every Acceptance Criterion below traces to a line in the Requirement
- [ ] All Requirement Refs exist in `PRD.md` and are fully covered by the Acceptance Criteria above

> An agent must NOT start implementing until this gate is checked. If anything here is unclear,
> STOP and ask the Supervisor (Karpathy: Think Before Coding).

---

## Dependencies & Reachability

**Depends on**: T012 — the verified MCQ pool and the attempt rows a flag must not change; T011 (via T012) — the review card component where the button goes and the review queue the flag filters.
**Entry point**: `This question seems wrong` (button label on the review card and the MCQ), handled by `flagQuestion`

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | `flagQuestion(learner, questionId, reason?)` stores one flag per learner per question (a repeat is a no-op, 200). `reason` is optional, ≤ 280 chars, stored as plain text. | "Learner flag: "this question seems wrong"" |
| 2 | After a flag, that question leaves this learner's review queue and is not drawn for this learner's future MCQ attempts. Other learners are not affected while the count is below the threshold. | flag button; US-008 |
| 3 | When distinct flaggers of one question reach `FLAG_REMOVE_MIN = 3`, its status becomes `removed`: it leaves every pool and every review queue, and one regenerate event `{ questionId, chunkId, ladderId }` is sent to the generation workflow (T008), which runs the full verification pipeline for the replacement. | "Frequently flagged cards are regenerated or removed" |
| 4 | Negative: a flag never changes the scoring of an attempt that already holds the question (it is still scored), and never writes or changes an evidence record. | anti-cheat: flag is not a skip (NFR-002) |
| 5 | Boundary: 2 distinct flaggers → status unchanged; the same learner flagging 3 times → count 1. The regenerate event is sent exactly once even if a 4th flag arrives. | "Frequently flagged" threshold |
| 6 | Unauthenticated flag → 401; flag on a question of a ladder the learner has not started → 404. | accounts from day one |

---

## Evaluation & Acceptance (How we know the agent worked correctly)

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | Learner A flags Q twice | 1 flag row; Q not in A's queue; Q in B's queue | integration test |
| 2 | Learners A, B, C flag Q | Q `removed`; not in any queue or pool; 1 regenerate event | integration test (Inngest test engine) |
| 3 | Learner D flags Q after removal | no second event | integration test |
| 4 | A has an open attempt holding Q, flags Q, submits | attempt scored on all 10 questions including Q | integration test |
| 5 | Flag request without a session | 401 | integration test |
| 6 | Click `This question seems wrong` on a review card | button shows "Flagged — thanks", card moves to next | Playwright |

### Verification Command (exact, runnable)

```bash
# describe blocks of this task start with "T016"
pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test -- -t "T016" && pnpm exec playwright test --grep T016
```

### Evidence (filled by reviewer at Stage 4/5)

> **Moved.** Filled by the reviewer at Stage 4/5 in `tasks/TASK_REVIEW_T016.md`.

---

## Demonstration

> **Moved.** See `tasks/TASK_REVIEW_T016.md`.

---

## UI / Design Acceptance Criteria

> Each row must name a verification method and produce pasted evidence before Done (Hard-Stop Gate 6).

### 1. Visual Regression

| Screen / Component | Verification method | Expected result |
|-------------------|---------------------|-----------------|
| Flag button on the review card (T011) and on the MCQ | Playwright screenshot at 360/768/1280 px + LLM-vision verdict with the rubric "secondary, low-emphasis button below the card; does not compete with the rating buttons; label exactly `This question seems wrong`" | "matches spec" on all 3 viewports |
| Flag confirmation (optional reason field + `Send` / `Cancel`, then "Flagged — thanks") | Playwright screenshot + LLM-vision verdict | both states readable; no layout shift of the rating buttons |

### 2. Design-System Compliance

| Criterion | Verification method | Expected result |
|-----------|---------------------|-----------------|
| Colors match design tokens | Playwright computed-style check | the button uses the theme's secondary/muted text token; no new hex literal in the diff (grep) |
| Typography matches spec | computed style | ≥ 14 px, theme font stack |
| Spacing / layout matches spec | computed style | tap target ≥ 44 × 44 px; ≥ 16 px from the nearest rating button |

### 3. Layout / Responsiveness

| Viewport | Verification method | Expected result |
|----------|---------------------|-----------------|
| Mobile (360px) | Playwright screenshot + `scrollWidth <= 360` | button full width under the card; reason field fits |
| Tablet (768px) | Playwright screenshot | button aligned under the card, not full width |
| Desktop (1280px) | Playwright screenshot | same as tablet |

---

## Approach

**Pattern reference**: T011's `submitReviewRating` (auth check, idempotent write, queue filter) for the flag handler; T008's generator entry for the regenerate event shape.

**Vital slice**: one flag per learner per question, per-learner hide, and the threshold that removes the question and sends one regenerate event.
**Cut list**:
- moderation screen and flag reasons review
- learner-weighted or rate-based thresholds (fixed count)
- notifying flaggers when the replacement exists

`FLAG_REMOVE_MIN = 3` is a Supervisor choice; the source says only "frequently flagged". With one learner (the owner), questions are hidden for that learner but never removed globally; this is intended. Use a unique index `(learner_id, question_id)` and an `INSERT ... ON CONFLICT DO NOTHING`; count and status change in one transaction with a row lock on the question, so the event is sent once. Write the migration (flag table, `removed` status value); it must pass `Skill({ skill: "migration-safety" })` and Common-Infrastructure applies it.

---

## Edge Case Checklist

- [ ] Two flags arrive at once and reach the threshold together → one status change, one event
- [ ] Removed question still in an open attempt → scored (AC 4); not drawn again
- [ ] Removed question had FSRS state for many learners → state kept in the DB, card hidden from queues
- [ ] Regeneration fails all verification rounds → question stays removed; no replacement; the pool can shrink below `MCQ_TEST_SIZE` (T012 then returns `pool-too-small`)
- [ ] Reason text with HTML → stored and later shown as text, never rendered as HTML

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| `flagQuestion` handler (server code area set by T003) | new |
| review queue query (T011) and MCQ pool draw (T012) | filter flagged-by-learner and `removed` |
| review card and MCQ components | add the flag button and confirmation |
| new migration (migrations folder set by T003) | flag table; `removed` status |
| tests (vitest, Playwright) | AC 1–6 |
| `tasks/TASK_REVIEW_T016.md` | Evidence (reviewer) |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `.claude/**`, `agents/**`, `skills/**`, `templates/**`, `AGENTS.md`, `CLAUDE.md` | kit |
| `PRD.md`, `PROJECT_SPEC.md`, `PROJECT_KANBAN.md` | Supervisor-owned |
| `experiments/**` | throwaway spikes; read only |
| scoring code and evidence module (T012) | a flag must not change scoring or proof |
| generator internals (T008) | send the event only |
| applied migrations of earlier tasks | add a new migration instead |

---

## Test Plan

Integration (vitest + test Postgres + Inngest test engine): every Success Criteria row 1–5 and the concurrency edge case (two parallel flags at count 2). E2E (Playwright): row 6 and the UI rows above. Paste `pnpm test` and Playwright output into the report.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run
- [ ] `Skill({ skill: "migration-safety" })` passed for the new migration
- [ ] Lint passes (`pnpm lint`, `pnpm typecheck`)
- [ ] Tests written AND pass — output pasted into `tasks/TASK_REVIEW_T016.md` Evidence (Hard-Stop Gate 5)
- [ ] UI Evidence rows (visual regression, design-system compliance, responsiveness) filled with pasted evidence (Hard-Stop Gate 6)
- [ ] `Skill({ skill: "verify" })` run — headless auto verify
- [ ] Supervisor notified: task ready for Stage 4 review
