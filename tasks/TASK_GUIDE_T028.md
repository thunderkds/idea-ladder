# TASK_GUIDE — T028: Cohort mode: 5–10 people on one ladder, shared progress
**Date**: 2026-11-01
**Complexity Level**: C3
**Risk Level**: Medium
**Priority**: P2
**Assigned agent**: frontend-developer
**Agent guide**: `agents/frontend.md`

---

## Mandatory Startup (Do Not Skip)

Before writing any code:
1. Read `PROJECT_SPEC.md`
2. Read the memory slice in your spawn prompt (`<!-- memory-slice -->`). Read `memory/MEMORY.md` in full only if your work reaches a file, hook, skill or decision the slice does not cover
3. Read this file completely
4. Read `agents/frontend.md`
5. Note the **Complexity Level** above and apply the matching process from the Complexity matrix in `agents/frontend.md` (C3: decompose into subtasks; `brainstorming` mandatory; adversarial `verify`)
6. C3: read `memory/codebase-map.md` (the app layout set by T003, once mapped). Read `tasks/TASK_GUIDE_T011.md` (daily review, review log), `tasks/TASK_GUIDE_T010.md` (ladder view, locked levels), `tasks/TASK_GUIDE_T015.md` (offline cache, push reminders), and `docs/REQUIREMENT_SOURCE.md` § Brainstorm: feature ideas, § Grill #2.

---

## Requirement (Pillar 1 — Adapt the requirement)

Requirement § Brainstorm: feature ideas: "Cohort mode (5 to 10 people, same ladder) — Social accountability lowers
dropout — v3". Roadmap v3: "cohort mode". § Grill #2: "Will anyone come back daily? — Only if the 5-minute review
feels good; test it before anything else". § Vision: "review daily in 5 minutes, and unlock each level only by
passing its test".

**Restated intent** (Supervisor's interpretation):
> A learner can start a cohort on one ladder and invite up to 9 others by link; every member sees, on one cohort
> page, each member's current level and how many days they reviewed this week, so the group keeps each other
> coming back.

**Out of scope** (what this task explicitly does NOT do):
- Chat, comments or messaging between members.
- Shared answers, shared evidence or any change to how a level passes (each member passes alone).
- Cohort leaderboards or rankings beyond the member list.
- Cohorts across several ladders.

**Requirement Refs**:
- US-002: a 5-minute daily review — the cohort adds accountability to it
- FR-007: level unlock and review scheduling stay deterministic; the cohort only displays them
- US-003: a level unlocks only after its test — shown, never shared
- FR-014: the PWA works offline — the cohort page shows its last synced data
- No FR names cohorts: PRD § Out of Scope keeps "cohorts" for after its gate; this guide is planned for that phase

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [ ] Restated intent confirmed to match the user's request (by Supervisor / user — not the implementing agent)
- [ ] Domain terms align with `PROJECT_SPEC.md` glossary (`grill-with-docs` run if terminology was fuzzy)
- [ ] Every Acceptance Criterion below traces to a line in the Requirement
- [ ] All Requirement Refs exist in `PRD.md` and are fully covered by the Acceptance Criteria above

> An agent must NOT start implementing until this gate is checked. If anything here is unclear,
> STOP and ask the Supervisor (Karpathy: Think Before Coding).

---

## Dependencies & Reachability

**Depends on**: T011 — the daily review and its stored review log (the source of "days reviewed this week") on top of T010's ladder view
**Entry point**: button label `Start a cohort` on the ladder view; routes `/cohorts/:cohortId` and `/cohorts/join/:inviteToken`

> v3 task: planned only. Pickup waits for Gate 3 ("Proof links get shared; first outside ladder PR").

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | On a ladder they follow, a signed-in learner clicks `Start a cohort`, names it (1–60 chars), and gets an invite link `/cohorts/join/<inviteToken>` (random, ≥ 128 bits) and a cohort page `/cohorts/<cohortId>`. | "Cohort mode ... same ladder" |
| 2 | A signed-in learner who opens a valid invite link joins the cohort and starts following the ladder if they did not. An expired (14 days), revoked or unknown token shows `This invite is no longer valid`. | invite flow; boundary |
| 3 | A cohort holds at most 10 members: the 11th join attempt shows `This cohort is full (10 of 10)` and the server rejects it (409), also when two people join at the same time with 9 members. | "5 to 10 people" (max enforced; 5 is a suggestion shown in the UI copy, not enforced) |
| 4 | The cohort page lists each member: GitHub login, avatar, current level (highest passed L0–L4), and `Reviewed N of the last 7 days` from the review log. Members see nothing else about each other (no answers, no review cards, no evidence). | "shared progress"; "Social accountability" |
| 5 | The creator can remove a member and revoke the invite link (new link generated); any member can `Leave cohort`. A removed member loses access to the cohort page (403 → `You are not in this cohort`). | membership control |
| 6 | The cohort page works offline with the last synced data (T015 cache) and shows `Last updated <time>`; it never shows stale data as live. | PWA offline (FR-014) consistency |
| 7 | The cohort API (`POST /api/cohorts`, `POST /api/cohorts/join`, `GET /api/cohorts/:id`, `DELETE /api/cohorts/:id/members/:memberId`) checks membership on every read; a non-member `GET` returns 403 with no member data in the body. | privacy of shared progress |

---

## Evaluation & Acceptance (How we know the agent worked correctly)

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | Learner A starts cohort, learner B opens the invite | B on the cohort page; B follows the ladder | Playwright (2 browser contexts) |
| 2 | Cohort with 9 members, 2 joins at once | exactly 1 succeeds; the other sees `This cohort is full (10 of 10)` | vitest (API, test DB) + Playwright |
| 3 | Member reviewed on 4 of the last 7 days | `Reviewed 4 of the last 7 days` | vitest + Playwright |
| 4 | Non-member calls `GET /api/cohorts/:id` | 403, body without member data | vitest |
| 5 | Invite token 15 days old | `This invite is no longer valid` | Playwright |
| 6 | Offline after one visit | cohort page with `Last updated <time>` | Playwright (offline context) |

### Verification Command (exact, runnable)

```bash
pnpm install --frozen-lockfile && pnpm db:migrate && pnpm test -- cohort && pnpm test:e2e -- cohort && pnpm lint
```

### Evidence (filled by reviewer at Stage 4/5)

> **Moved.** Filled by the reviewer at Stage 4/5 in `tasks/TASK_REVIEW_T028.md`.

---

## Demonstration

> **Moved.** See `tasks/TASK_REVIEW_T028.md`.

---

## UI / Design Acceptance Criteria

### 1. Visual Regression

| Screen / Component | Verification method | Expected result |
|-------------------|---------------------|-----------------|
| `/cohorts/:cohortId` with 6 members | Playwright screenshot at 1280 px + LLM-vision verdict against AC 4 | header (cohort name, ladder, invite link copy button), then one row per member with level and review days; verdict "matches spec" |
| `Start a cohort` dialog on the ladder view | Playwright screenshot + LLM-vision verdict | name field, create button, copy-link step after create |
| invite states: valid join, `This invite is no longer valid`, `This cohort is full (10 of 10)` | Playwright screenshots + LLM-vision verdict | each state is a clear single message with one action |

### 2. Design-System Compliance

| Criterion | Verification method | Expected result |
|-----------|---------------------|-----------------|
| Colors match design tokens | computed-style check on member rows, level badges and buttons + token lint (no raw hex outside the token file set by T003/T010) | level badges reuse T010's level colours; buttons use the existing button tokens |
| Typography matches spec | computed-style check on cohort title, member login, review-days text | heading / body / secondary tokens from T010 |
| Spacing / layout matches spec | computed-style check on row padding and list gap | existing spacing tokens |

### 3. Layout / Responsiveness

| Viewport | Verification method | Expected result |
|----------|---------------------|-----------------|
| Mobile (360px) | Playwright screenshot + LLM-vision verdict; assert `document.documentElement.scrollWidth <= 360` | one member per row; level and review days stack under the login; no horizontal page scroll |
| Tablet (768px) | Playwright screenshot + LLM-vision verdict | one row per member, columns inline |
| Desktop (1280px) | Playwright screenshot + LLM-vision verdict | member list at max content width |

---

## Approach

**Pattern reference**: T010's ladder view (level badges, locked levels) and T011's review log query for "days reviewed"; T015's service-worker cache rules for the offline cohort page.

**Vital slice**: create → invite → join → cohort page with level + review days for each member.
**Cut list**:
- push reminders that name cohort members ("3 of your cohort reviewed today") — later, uses T015's channel
- cohort chat or reactions
- minimum size enforcement (5 is guidance only)
- cohort history / weekly summaries

C3 process: run `Skill({ skill: "brainstorming" })` first (privacy of shared progress, invite token model,
offline behaviour), then decompose. This role owns the UI; the cohort API and migration (tables `cohorts`,
`cohort_members`, `cohort_invites`, run through `Skill({ skill: "migration-safety" })`) are a backend sub-slice
with the contract in AC 7: the Supervisor may spawn backend-developer for it, and the UI consumes only that
contract. Enforce the 10-member cap in the DB (count check in one transaction with a row lock on the cohort),
not only in the UI. Store only the hash of each invite token.

---

## Edge Case Checklist

- [ ] Creator leaves — creator role passes to the earliest remaining member; empty cohort is archived
- [ ] Member already in the cohort opens the invite again — goes to the cohort page, no duplicate row
- [ ] Member stops following the ladder — stays in the cohort, level shown as last known
- [ ] Learner in two cohorts on the same ladder — allowed; each page independent
- [ ] Time zones for "last 7 days" — count by the member's own review-log day boundaries (as T011 stores them), state this in the UI tooltip
- [ ] Invite link shared publicly — expiry + revoke cover it; the cap limits damage
- [ ] Signed-out visitor opens the invite — sign in with GitHub, then continue the join with the same token

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| pages/routes folder in the app layout set by T003 (see `memory/codebase-map.md` once mapped) | `/cohorts/:cohortId`, `/cohorts/join/:inviteToken`, `Start a cohort` dialog on the ladder view |
| API routes (backend sub-slice) | `POST /api/cohorts`, `POST /api/cohorts/join`, `GET /api/cohorts/:id`, `DELETE /api/cohorts/:id/members/:memberId` |
| new migration in T003's migrations folder (backend sub-slice) | `cohorts`, `cohort_members`, `cohort_invites` |
| service worker cache rules from T015 | cache the cohort page data |
| tests `cohort` (vitest + Playwright) | AC 1–7 |
| `tasks/TASK_REVIEW_T028.md` | Evidence (reviewer) |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `.claude/**`, `agents/**`, `skills/**`, `templates/**`, `AGENTS.md`, `CLAUDE.md` | kit |
| `PRD.md`, `PROJECT_SPEC.md`, `PROJECT_KANBAN.md` | Supervisor-owned |
| `experiments/**` | throwaway spikes |
| FSRS scheduler and review log writer (T011) | read only; the cohort never changes scheduling |
| level pass verifiers and evidence records (T012, T013) | read only; the cohort never changes a pass |

---

## Test Plan

vitest API tests on the test DB for membership checks, the 10-member cap under concurrency, invite expiry and
the review-days count (Success 2–4). Playwright with two or more browser contexts for the invite flow, the
offline page and the UI section at 360/768/1280 px with LLM-vision verdicts (Success 1, 5, 6). Adversarial
verify (C3): a second agent tries to read a cohort as a non-member, to join an 11th member, and to reuse a
revoked token. Real run: create a cohort in the dev app with 2 test accounts, paste screenshots.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run
- [ ] Security review: `Skill({ skill: "security-review" })` run (Medium risk — shared progress, invite tokens)
- [ ] `Skill({ skill: "migration-safety" })` run (cohort tables)
- [ ] Lint passes (`pnpm lint`, `tsc --noEmit`)
- [ ] Tests written AND pass — output pasted into `tasks/TASK_REVIEW_T028.md` Evidence (Hard-Stop Gate 5)
- [ ] UI / Design Evidence rows filled with screenshots and verdicts (Hard-Stop Gate 6)
- [ ] `Skill({ skill: "verify" })` run — headless auto verify (adversarial at C3)
- [ ] Supervisor notified: task ready for Stage 4 review
