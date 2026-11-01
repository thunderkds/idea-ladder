# TASK_GUIDE — T030: Pass-test screens — MCQ attempt, artifact submit (L1/L2/L4), diff-question attempt, result view
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
6. C2: read `memory/codebase-map.md` (the app layout set by T003). Read `tasks/TASK_GUIDE_T012.md`, `tasks/TASK_GUIDE_T013.md` (incl. the user's L1 decision) and `tasks/TASK_GUIDE_T014.md` for the handler contracts and status values. Read `docs/REQUIREMENT_SOURCE.md` § Repo to ladder engine (level table), § Proof architecture (anti-cheat), § Diagram text "Sequence: pass test and proof"; `docs/MAIN_FLOW.md` § 3 and § 4.

---

## Requirement (Pillar 1 — Adapt the requirement)

Source (`docs/REQUIREMENT_SOURCE.md`):
- § Vision: "unlock each level only by passing its test."
- § Vision flow: "A failed pass test loops back to study and review until the level is earned."
- § Repo to ladder engine, level table: "L1 Run it — Screenshot or log + 3-sentence explanation"; "L2 Modify — Branch or diff link + questions generated from your diff"; "L3 Understand — Verified MCQs on core files"; "L4 Rebuild or contribute — Repo link or PR link".
- § Sequence: pass test and proof: "submit L2 branch" → "push: 5 questions on your code" → "answers" → "L3 unlocked (fail: back to review cards)".
- § Proof architecture: "MCQs are drawn from a randomized pool; retakes are rate-limited; artifacts must match the signed-in GitHub account."
- `docs/MAIN_FLOW.md` § 3: "Pass test — not yet → Daily loop; passed → Proof profile → Next level unlocks".

**Restated intent** (Supervisor's interpretation):
> The learner can take every pass test from the ladder view: answer an MCQ attempt, submit an L1/L2/L4 artifact link, and answer the 5 diff questions. Then they see a result view: a pass shows the newly unlocked level, and a fail sends them back to the linked review cards. The screens only call the T012–T014 handlers; no pass decision is made in the client.

**Out of scope** (what this task explicitly does NOT do):
- Scoring, verification, rate limiting, evidence records (server, T012–T014).
- Proof profile and public verify page (T020, T021).
- Offline pass tests (T015 shows the offline message; this task reuses it).
- Push notification for "questions ready" (T015); this screen polls the T014 status.
- AI feedback on the L3 explanation.

**Requirement Refs** (FR/NFR/US IDs from `PRD.md` this task satisfies):
- US-003: a level unlocks only after its test is passed
- US-004: questions generated from the learner's own diff (answer screen)
- FR-004: L1–L4 pass tests (learner-facing part)
- FR-016: randomized pool; rate-limited retakes (shown to the learner)
- NFR-002: the LLM is never in the trust path (the client decides nothing)

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [ ] Restated intent confirmed to match the user's request (by Supervisor / user — not the implementing agent)
- [ ] Domain terms align with `PROJECT_SPEC.md` glossary (`grill-with-docs` run if terminology was fuzzy)
- [ ] Every Acceptance Criterion below traces to a line in the Requirement
- [ ] All Requirement Refs exist in `PRD.md` and are fully covered by the Acceptance Criteria above

> An agent must NOT start implementing until this gate is checked. If anything here is unclear,
> STOP and ask the Supervisor (Karpathy: Think Before Coding).

---

## Dependencies & Reachability

> Advisory, not a Hard-Stop Gate. `Depends on` is verified (non-blocking warning) at Agent-spawn
> time by `pre_agent_validate_guide.py`. `Entry point` is verified (non-blocking finding) at Stage 4
> `code-review` time.

**Depends on**: T012 — `startMcqAttempt` / `submitMcqAttempt`, error codes (`pool-too-small`, 429 `retryAt`), review card ids on fail; T013 — `verifyL1RunLog`, `verifyL2Branch`, `verifyL4Artifact` and their reason codes, plus the L1 nonce (option A); T014 — diff-question status values and `submitDiffAnswers`. The MCQ screen may be built against T012 first; the artifact and diff screens wait for T013 / T014.
**Entry point**: `Take the test` (button label on an unlocked, not-yet-passed level in the ladder view)

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | MCQ attempt screen: `Take the test` on an MCQ level calls `startMcqAttempt` and shows the 10 questions with options in the order the server sent. `Submit answers` stays disabled until every question has an answer, then calls `submitMcqAttempt` once (double click → one request). The page source and client state never hold an answer key (the server sends none; the test asserts no `key` field reaches the client). | "Verified MCQs"; FR-016; NFR-002 |
| 2 | Result view: a pass shows "Level passed" and the name of the next level, now unlocked, with a link to it. A fail shows the score (e.g. "7 of 10") and the linked review cards with `Review these cards`, which opens the T011 review screen filtered to them. The view shows only what the server returned; no client-side scoring. | "L3 unlocked (fail: back to review cards)"; "loops back to study and review" |
| 3 | Artifact submit screen per level: L1 shows the nonce and fields for the run-log link and the 3-sentence explanation (option A of T013; a different user choice changes this row before spawn); L2 asks for a branch link; L4 asks for a repo link or a PR link. The server's reason code is shown in plain words (`author-mismatch` → "These commits are not by your GitHub account", `pr-not-merged` → "This PR is not merged yet", `not-found`, `no-new-commits`, `not-from-scratch`, invalid URL). | L1/L2/L4 pass tests; "artifacts must match the signed-in GitHub account" |
| 4 | Diff-question screen: after an L2 branch is verified, the screen shows "Making 5 questions on your code" and polls the T014 status at most every 5 s. `ready` → 5 questions, submit via `submitDiffAnswers`, then the result view of AC 2 (pass = 4 of 5 by the server). `diff-questions-unavailable` / `diff-not-testable` → the reason and `Submit another branch`. | "push: 5 questions on your code"; "pass 4 of 5" |
| 5 | Boundary and negative: a 429 shows "Next attempt at" with the server's `retryAt` in the learner's local time and no retry button before then; `pool-too-small` shows "This level's test is not ready yet"; an attempt older than 30 min shows "This attempt expired" and `Start a new attempt`; offline shows T015's "You are offline — this needs a connection". | FR-016 "retakes are rate-limited"; T012 limits |
| 6 | A locked level shows no `Take the test` button; a direct URL to its test screen shows "Pass the previous level first". | "unlock each level only by passing its test" |
| 7 | Keyboard and screen reader: every question is a `fieldset` with a `legend`, options are radio inputs, results are announced via `aria-live="polite"`; axe-core scan of each screen reports 0 serious or critical issues. | accessible pass tests (frontend role guide) |

---

## Evaluation & Acceptance (How we know the agent worked correctly)

> Fill **Success Criteria** and **Verification Command** at Stage 2 (before spawning the agent).
> The reviewer fills **Evidence** at Stage 4/5 in `tasks/TASK_REVIEW_T030.md`.

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | Mocked `startMcqAttempt` returning 10 questions; 9 answered | `Submit answers` disabled; after the 10th, enabled; double click sends 1 request | Playwright (network mocks) |
| 2 | Mocked submit → pass, next level L4 | "Level passed", link to L4 | Playwright |
| 3 | Mocked submit → fail 7/10 with 3 card ids | "7 of 10"; `Review these cards` opens review with those 3 cards | Playwright |
| 4 | Mocked `verifyL2Branch` → `author-mismatch` | "These commits are not by your GitHub account"; form keeps the URL | Playwright |
| 5 | Mocked diff status `generating` → `ready` | progress text, then 5 questions; poll interval ≥ 5 s | Playwright with clock control |
| 6 | Mocked 429 with `retryAt` = now + 3 h | "Next attempt at" with local time; no start button | Playwright |
| 7 | Locked level URL opened directly | "Pass the previous level first" | Playwright |
| 8 | Each screen | axe-core: 0 serious / critical | Playwright + `@axe-core/playwright` |
| 9 | Full flow against the real T012 handlers and seeded test DB | pass unlocks the next level in the ladder view | Playwright (integration, test Postgres) |

### Verification Command (exact, runnable)

```bash
# describe blocks of this task start with "T030"
pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test -- -t "T030" && pnpm exec playwright test --grep T030
```

### Evidence (filled by reviewer at Stage 4/5)

> **Moved.** Filled by the reviewer at Stage 4/5 in `tasks/TASK_REVIEW_T030.md`.

---

## Demonstration

> **Moved.** See `tasks/TASK_REVIEW_T030.md`.

---

## UI / Design Acceptance Criteria

> Each row must name a verification method and produce pasted evidence before Done (Hard-Stop Gate 6).

### 1. Visual Regression

| Screen / Component | Verification method | Expected result |
|-------------------|---------------------|-----------------|
| MCQ attempt (10 questions, progress "n of 10", `Submit answers`) | Playwright screenshot at 360/768/1280 px + LLM-vision verdict with the rubric "one question block per item, radio options readable, progress visible, submit at the end" | "matches spec" on all 3 viewports; screenshots committed as baselines |
| Artifact submit (L1, L2, L4 variants) with an error message | Playwright screenshot + LLM-vision verdict | correct fields per level; error text next to the field |
| Diff-question waiting state and 5-question screen | Playwright screenshot + LLM-vision verdict | progress text, then 5 questions |
| Result view: pass and fail | Playwright screenshot + LLM-vision verdict | pass shows the unlocked level; fail shows the score and `Review these cards`; neither looks like an error page |

### 2. Design-System Compliance

| Criterion | Verification method | Expected result |
|-----------|---------------------|-----------------|
| Colors match design tokens | Playwright computed-style check on buttons, result banners, error text | every color resolves to a CSS custom property of the theme used by T010/T011; no new hex literal in the diff (grep); pass/fail not shown by color alone (text + icon) |
| Typography matches spec | computed style | body ≥ 16 px; theme font stack |
| Spacing / layout matches spec | computed style | each radio option row and button ≥ 44 × 44 px tap target; ≥ 8 px between options |

### 3. Layout / Responsiveness

| Viewport | Verification method | Expected result |
|----------|---------------------|-----------------|
| Mobile (360px) | Playwright screenshot + `document.documentElement.scrollWidth <= 360` | one column; options full width; long URLs wrap; no horizontal scroll |
| Tablet (768px) | Playwright screenshot | one column, max width kept, centred |
| Desktop (1280px) | Playwright screenshot | same as tablet; keyboard-only run completes an attempt |

---

## Approach

**Pattern reference**: T011's review screen (data loading, theme tokens, Playwright clock control, error/retry pattern) and T010's ladder view (level lock state) — imitate their file layout and component style.

**Vital slice**: the MCQ attempt → submit → result view loop against T012 (it works before T013/T014 land).
**Cut list**:
- per-question timer (only the 30-minute attempt limit, shown as a countdown)
- saving a half-finished attempt across reloads (an expired attempt starts again)
- answer review after a pass (which question was wrong) — only the score and linked cards
- screenshot upload for L1 (only if the user picks T013 option C)

Build one shared result view used by all three test types. Map server reason codes to text in one module, so new codes have one place to go. Poll the T014 status with a fixed 5 s interval, stopping on a final status or when the page is hidden (`visibilitychange`). Never compute a score or unlock state in the client; after a pass, re-fetch the ladder view data. No new migration in this task.

---

## Edge Case Checklist

- [ ] Learner opens the same attempt in two tabs and submits in both → second gets the server's rejection; UI shows "Already submitted" and the stored result
- [ ] Network drops during submit → "Not sent — try again" with the same request; never shows a result the server did not send
- [ ] Attempt expires while answering → countdown hits 0, submit shows "This attempt expired"
- [ ] Very long question or option text (≤ 500 chars) → wraps on 360 px
- [ ] Branch URL pasted with trailing spaces or `.git` → trimmed client-side for display; the server still validates
- [ ] Diff status never leaves `generating` (worker down) → after 10 min, show "Taking longer than usual" and a `Check again` button; polling stops
- [ ] Learner navigates away mid-attempt → confirm dialog only when ≥ 1 answer is chosen

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| MCQ attempt screen (route path per the app layout set by T003; see `memory/codebase-map.md`) | new |
| artifact submit screen (L1/L2/L4) | new |
| diff-question screen | new |
| shared result view + reason-code text module | new |
| ladder view level card (T010) | add `Take the test` button for unlocked, not-passed levels |
| tests (vitest, Playwright, `@axe-core/playwright` exact pin) | AC 1–7 |
| `tasks/TASK_REVIEW_T030.md` | Evidence (reviewer) |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `.claude/**`, `agents/**`, `skills/**`, `templates/**`, `AGENTS.md`, `CLAUDE.md` | kit |
| `PRD.md`, `PROJECT_SPEC.md`, `PROJECT_KANBAN.md` | Supervisor-owned |
| `experiments/**` | throwaway spikes; read only |
| server handlers, scoring, verifiers and evidence module (T012–T014) | consume only; a needed change goes back to the Supervisor |
| migrations | this task adds no schema |

---

## Test Plan

Unit (vitest): reason-code → text mapping, poll stop rules. E2E (Playwright with network mocks and clock control): Success Criteria 1–8 and the UI rows above. Integration E2E (Playwright against the real T012 handlers and a seeded test Postgres): Success Criterion 9; extend to T013/T014 handlers once merged (recorded GitHub fixtures and mock models, no network). Paste `pnpm test` and Playwright output into the report.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run
- [ ] Security review: `Skill({ skill: "security-review" })` run (Medium risk)
- [ ] Lint passes (`pnpm lint`, `pnpm typecheck`)
- [ ] Tests written AND pass — output pasted into `tasks/TASK_REVIEW_T030.md` Evidence (Hard-Stop Gate 5)
- [ ] UI Evidence rows (visual regression, design-system compliance, responsiveness) filled with pasted evidence (Hard-Stop Gate 6)
- [ ] `Skill({ skill: "verify" })` run — headless auto verify
- [ ] Supervisor notified: task ready for Stage 4 review
