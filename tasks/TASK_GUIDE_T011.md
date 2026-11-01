# TASK_GUIDE — T011: Daily 5-minute review with FSRS (ts-fsrs 5.4.2), review log stored
**Date**: 2026-11-01
**Complexity Level**: C2
**Risk Level**: Medium
**Priority**: P0
**Assigned agent**: frontend-developer
**Agent guide**: `agents/frontend.md`

---

## Mandatory Startup (Do Not Skip)

Before writing any code:
1. Read `PROJECT_SPEC.md`
2. Read the memory slice in your spawn prompt (`<!-- memory-slice -->`). Read `memory/MEMORY.md` in full only if your work reaches a file, hook, skill or decision the slice does not cover
3. Read this file completely
4. Read `agents/frontend.md`
5. Note the **Complexity Level** above and apply the matching process from the Complexity matrix in `agents/frontend.md`
6. C2: read `memory/codebase-map.md` (the app layout set by T003). Read `docs/REQUIREMENT_SOURCE.md` § LLM strategy (row "Unlock levels, schedule reviews"), § Framework stack (row "Scheduler"), § Brainstorm: feature ideas, § Daily loop inside each level, § Grill #2 and #11; `docs/MAIN_FLOW.md` § 5 (conflicts C1 and C3).

---

## Requirement (Pillar 1 — Adapt the requirement)

Source (`docs/REQUIREMENT_SOURCE.md`):
- § Vision: "review daily in 5 minutes, and unlock each level only by passing its test."
- § Brainstorm: feature ideas: "5-minute daily review with FSRS — The daily habit; retention lives or dies here — MVP".
- § LLM strategy: "Unlock levels, schedule reviews — No — Deterministic code and FSRS — Must be reproducible".
- § Framework stack: "Scheduler — FSRS library — Deterministic review intervals".
- § Grill #2: "Will anyone come back daily? Only if the 5-minute review feels good".
- § Grill #11: "iOS clears PWA storage? Push install early; sync to backend; export/import".
- `docs/MAIN_FLOW.md` § 5: C1 "FSRS wins; the fixed days are an illustration"; C3 "5 min = review only; a level's learn step is longer".
- User decision 2026-11-01: accounts from day one; progress and reviews stored in Postgres. Stack pin: `ts-fsrs` 5.4.2.

**Restated intent** (Supervisor's interpretation):
> The signed-in learner opens a review session that shows the review cards due now from their unlocked levels, rates each card, and stops at 5 minutes or when nothing is due. ts-fsrs 5.4.2 alone computes each next due date; every rating is stored server-side as an append-only review log row, so the schedule is reproducible from the log.

**Out of scope** (what this task explicitly does NOT do):
- Offline review, service worker, push reminders, export/import (T015).
- Pass tests and level unlock (T012); the "This question seems wrong" flag (T016).
- Generating cards (T008); the learn step of a level (20–30 min, not part of the 5-minute review).
- FSRS parameter optimisation from the learner's own log (default parameters only).
- Cohort or shared progress (T028).

**Requirement Refs** (FR/NFR/US IDs from `PRD.md` this task satisfies):
- US-002: 5-minute daily review scheduled for the learner
- FR-007: review scheduling is deterministic code (FSRS); no LLM
- NFR-007: progress syncs to the backend (sync part only; export/import is T015)

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [ ] Restated intent confirmed to match the user's request (by Supervisor / user — not the implementing agent)
- [ ] Domain terms align with `PROJECT_SPEC.md` glossary (`grill-with-docs` run if terminology was fuzzy)
- [ ] Every Acceptance Criterion below traces to a line in the Requirement
- [ ] All Requirement Refs exist in `PRD.md` and are fully covered by the Acceptance Criteria above

> An agent must NOT start implementing until this gate is checked. If anything here is unclear,
> STOP and ask the Supervisor (Karpathy: Think Before Coding).

---

## Dependencies & Reachability

**Depends on**: T010 — the ladder view, its level lock state and its link target for "Start review"; T010 in turn reads the ladder and card tables that T003/T005 created.
**Entry point**: `Start review` (button label on the ladder view and on "My ladders"), handled by `submitReviewRating`

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | The review queue for the signed-in learner holds only cards with `due <= now` that belong to levels unlocked for that learner, ordered by `due` ascending. Cards of a locked level never appear, even when due. | "unlock each level only by passing its test"; FSRS scheduling |
| 2 | Each rating (`Again`, `Hard`, `Good`, `Easy`) is turned into the next card state by `ts-fsrs` 5.4.2 only. For the same prior card state, rating and review time, the stored next state (`due`, `stability`, `difficulty`, `state`, `reps`, `lapses`) equals the library output exactly. `package.json` pins `"ts-fsrs": "5.4.2"` (no `^` or `~`). | "Deterministic code and FSRS — Must be reproducible"; stack pin |
| 3 | Each rating appends exactly one review log row (learner id, card id, rating, state before, state after, `reviewed_at` server time, elapsed ms). Replaying a learner's review log from the initial card state with ts-fsrs reproduces the stored card state. The log table rejects UPDATE and DELETE. | "review log stored"; "Must be reproducible"; NFR-007 sync |
| 4 | The session ends when the queue is empty or when 5:00 of session time has passed, whichever comes first. A card still on screen at 5:00 can be rated; no new card is shown after that. Unrated cards stay due for the next session. | "review daily in 5 minutes"; C3 "5 min = review only" |
| 5 | Empty queue → the screen shows "Nothing due" and the next due time (or "No cards yet" when the learner has no cards). No error, no request loop. | daily review habit (Grill #2) |
| 6 | A retried rating with the same idempotency key does not create a second log row or advance the card twice. A server error leaves the card on screen with a retry action; the rating is not lost silently. | review log stored; NFR-007 |
| 7 | An unauthenticated rating request → 401. A rating for a card of a ladder the learner has not started, or of another learner's state, → 404 with no state change. | accounts from day one (user decision) |

---

## Evaluation & Acceptance (How we know the agent worked correctly)

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | Seeded learner with 3 due cards in unlocked L0, 2 due cards in locked L1 | queue = the 3 L0 cards, oldest `due` first | integration test (vitest + test DB) |
| 2 | New card, rating `Good` at fixed time `2026-11-01T09:00:00Z` | stored state equals `fsrs(params).next(card, t, Rating.Good).card` for the same params | vitest |
| 3 | 10 ratings on one card, then replay of its log rows | replayed state deep-equals stored state | vitest |
| 4 | Fake clock at 4:59 with 1 card shown, then 5:01 | the shown card can be rated; next card is not shown; session-end screen appears | Playwright with clock control |
| 5 | Same rating request sent twice with one idempotency key | 1 log row; `reps` advanced once | integration test |
| 6 | Rating request with no session cookie; rating for another learner's card | 401; 404, card state unchanged | integration test |
| 7 | UPDATE or DELETE on a review log row | the database rejects it | integration test |

### Verification Command (exact, runnable)

```bash
# describe blocks of this task start with "T011" so the filters below select them
pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test -- -t "T011" && pnpm exec playwright test --grep T011
```

### Evidence (filled by reviewer at Stage 4/5)

> **Moved.** Filled by the reviewer at Stage 4/5 in `tasks/TASK_REVIEW_T011.md`.

---

## Demonstration

> **Moved.** See `tasks/TASK_REVIEW_T011.md`.

---

## UI / Design Acceptance Criteria

> Each row must name a verification method and produce pasted evidence before Done (Hard-Stop Gate 6).

### 1. Visual Regression

| Screen / Component | Verification method | Expected result |
|-------------------|---------------------|-----------------|
| Review card, front (question) and back (answer + 4 rating buttons) | Playwright screenshot at 360/768/1280 px + LLM-vision verdict against the rubric "one card, readable question, answer hidden until `Show answer`, 4 rating buttons in order Again/Hard/Good/Easy, timer visible" | verdict "matches spec" on all 3 viewports; screenshots committed as baselines |
| Empty state ("Nothing due" with next due time) and session-end screen | Playwright screenshot + LLM-vision verdict | text present, no layout break, no console error |

### 2. Design-System Compliance

| Criterion | Verification method | Expected result |
|-----------|---------------------|-----------------|
| Colors match design tokens | Playwright computed-style check on card, buttons, timer | every color resolves to a CSS custom property of the theme used by T010; no new hex literal in the diff (grep) |
| Typography matches spec | computed style | body text ≥ 16 px; font-family = the T010 theme font stack |
| Spacing / layout matches spec | computed style | each rating button has a tap target ≥ 44 × 44 px; ≥ 8 px gap between rating buttons |

### 3. Layout / Responsiveness

| Viewport | Verification method | Expected result |
|----------|---------------------|-----------------|
| Mobile (360px) | Playwright screenshot + `document.documentElement.scrollWidth <= 360` | card full width; 4 rating buttons in one row or a 2 × 2 grid; no horizontal scroll |
| Tablet (768px) | Playwright screenshot | card centred, max width kept; buttons in one row |
| Desktop (1280px) | Playwright screenshot | same as tablet; keyboard keys 1–4 rate the card and Space shows the answer |

---

## Approach

**Pattern reference**: the ladder view and its data loading from T010 (component structure, server data access, theme tokens) — imitate its file layout; for a deterministic pure function with a fixed-clock test, imitate `experiments/core-spike/src/proof.ts` + its tests (pure function, no I/O, inputs fully given).

**Vital slice**: the due queue + one rating → ts-fsrs next state → one review log row, on the server, with the minimal review screen.
**Cut list**:
- FSRS parameter optimisation (default parameters; revisit when a learner has ≥ 1,000 reviews)
- review statistics and streak charts
- undo of the last rating
- per-learner daily new-card limit setting (fixed constant)

Server owns the schedule: the client sends `{ cardId, rating, idempotencyKey, elapsedMs }`; the server reads the card state, calls `fsrs(generatorParameters({ enable_fuzz: false })).next(card, now, rating)` with server time, writes the new state and the log row in one transaction. Fuzz is off so a replay of the log gives the same dates ("Must be reproducible"). Keep the FSRS call in one pure module (`scheduleNext(state, rating, now)`) so T015 can reuse it. New cards enter the queue at most `NEW_CARDS_PER_DAY = 10` per learner per day (constant). The 5-minute cap is a client timer that starts at the first card; the server does not enforce it. Write the migration for the card-state and review-log tables; it must pass `Skill({ skill: "migration-safety" })` and Common-Infrastructure applies it. Make the log table append-only with a trigger that raises on UPDATE/DELETE.

---

## Edge Case Checklist

- [ ] Card due exactly at `now` → in the queue (`<=`, not `<`)
- [ ] A level is locked again (should not happen, but data says locked) → its cards leave the queue; their state is kept
- [ ] Client clock differs from server clock → server time is the only `reviewed_at`
- [ ] Two tabs rate the same card → second rating applies to the updated state (row lock or version check), never to a stale one
- [ ] Rating arrives after the card was already rated in this session (double tap) → idempotency key dedupes
- [ ] DST change or a learner in UTC+14 → `due` stored as UTC `timestamptz`; "Nothing due until" shown in the learner's local time
- [ ] ts-fsrs `Rating.Manual` is never accepted from the client
- [ ] Ladder with 0 cards → "No cards yet", not "Nothing due"

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| review screen route and components (path per the app layout set by T003; see `memory/codebase-map.md`) | new: queue, card, rating buttons, timer, empty and end states |
| `scheduleNext` scheduler module (server code area set by T003) | new: pure wrapper around ts-fsrs 5.4.2 |
| review queue + `submitReviewRating` server handlers | new: queue query, rating write in one transaction |
| new migration (migrations folder set by T003) | card-state and review-log tables; append-only trigger |
| `package.json`, lockfile | add `ts-fsrs` exactly `5.4.2` |
| ladder view "Start review" button (T010 component) | link to the review screen only |
| tests (vitest + Playwright, folders set by T003/T010) | AC 1–7 |
| `tasks/TASK_REVIEW_T011.md` | Evidence (reviewer) |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `.claude/**`, `agents/**`, `skills/**`, `templates/**`, `AGENTS.md`, `CLAUDE.md` | kit |
| `PRD.md`, `PROJECT_SPEC.md`, `PROJECT_KANBAN.md` | Supervisor-owned |
| `experiments/**` | throwaway spikes and the v0 kit; read only |
| applied migrations of T003–T010 | never edit an applied migration; add a new one |
| service worker / PWA manifest | T015 |

---

## Test Plan

Unit (vitest): `scheduleNext` against direct ts-fsrs calls on fixed times for all 4 ratings and all card states (New, Learning, Review, Relearning); log replay. Integration (vitest + test Postgres from T003's test setup): queue query, transaction, idempotency, auth, append-only trigger. E2E (Playwright, clock control): full session, 5-minute cap, empty state, plus the UI rows above. Paste `pnpm test` and Playwright output into the report.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run
- [ ] Security review: `Skill({ skill: "security-review" })` run (Medium risk)
- [ ] `Skill({ skill: "migration-safety" })` passed for the new migration
- [ ] Lint passes (`pnpm lint`, `pnpm typecheck`)
- [ ] Tests written AND pass — output pasted into `tasks/TASK_REVIEW_T011.md` Evidence (Hard-Stop Gate 5)
- [ ] UI Evidence rows (visual regression, design-system compliance, responsiveness) filled with pasted evidence (Hard-Stop Gate 6)
- [ ] `Skill({ skill: "verify" })` run — headless auto verify
- [ ] Supervisor notified: task ready for Stage 4 review
