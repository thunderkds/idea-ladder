# TASK_GUIDE — T029: "Learn what's trending" weekly pick
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
6. C1: skip `memory/codebase-map.md` unless you cannot find the Inngest functions folder. Read `tasks/TASK_GUIDE_T023.md` and `docs/contracts/start-url.md` (the `/start?url=` contract the pick links to), `tasks/TASK_GUIDE_T005.md` (GitHub reads with the app token), and `experiments/core-spike/src/confidence.ts`.

---

## Requirement (Pillar 1 — Adapt the requirement)

Requirement § Brainstorm: feature ideas: ""Learn what's trending" weekly pick — Fresh entry points; pairs with Idea
Radar's brief — v3". § Architecture: "No shared database, login or API between them. The only contract is
`https://<ladder-app>/start?url=<repo or any URL>`". Architecture diagram: "GitHub API (public): each app calls it on
its own, with its own token." § Repo to ladder engine: "Score confidence: thin README or no issues means low
confidence; fall back to concept-only ladders."

**Restated intent** (Supervisor's interpretation):
> Once a week the app picks one trending GitHub repo that would make a good ladder and shows it on "My ladders" as
> `This week's pick` with a `Learn this` link through `/start?url=`, using only the app's own GitHub reads, never
> Idea Radar's data.

**Out of scope** (what this task explicitly does NOT do):
- Reading Idea Radar's database, API or brief (forbidden by § Architecture).
- Pre-generating the picked ladder (generation starts only when a learner clicks, through T005).
- Personalised picks, several picks per week, email digests.
- Push notification of the pick (T015's channel; later).

**Requirement Refs**:
- FR-015: the pick links through `/start?url=` only
- FR-001: the candidate repos are read through the GitHub API
- FR-005: candidates with a low confidence score are not picked
- NFR-009: GitHub rate limits and errors give no pick, not a wrong one
- US-001: a pick becomes a ladder through `/start?url=`

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [ ] Restated intent confirmed to match the user's request (by Supervisor / user — not the implementing agent)
- [ ] Domain terms align with `PROJECT_SPEC.md` glossary (`grill-with-docs` run if terminology was fuzzy)
- [ ] Every Acceptance Criterion below traces to a line in the Requirement
- [ ] All Requirement Refs exist in `PRD.md` and are fully covered by the Acceptance Criteria above

> An agent must NOT start implementing until this gate is checked. If anything here is unclear,
> STOP and ask the Supervisor (Karpathy: Think Before Coding).

---

## Dependencies & Reachability

**Depends on**: T023 — the documented and contract-tested `/start?url=` link the pick uses
**Entry point**: `pickTrendingWeekly` (Inngest cron function); UI text `This week's pick`

> v3 task: planned only. Pickup waits for Gate 3 ("Proof links get shared; first outside ladder PR").

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | `pickTrendingWeekly` runs on an Inngest cron once a week (Monday 06:00 UTC). It queries GitHub search for repos created in the last 30 days, sorted by stars (top 30), with the app token. | "weekly pick"; "each app calls it on its own, with its own token" |
| 2 | Each candidate is scored with the confidence rule (port of `confidenceScore`); candidates with `fallbackToConcepts: true`, no licence, archived, or a fork are dropped. The pick is the highest-star survivor not picked in the last 8 weeks. | "thin README ... low confidence" |
| 3 | The pick is stored as `{ weekStart, repo, sha, stars, confidence, pickedAt }`, one row per week (unique `weekStart`); a retried run in the same week does not change the pick. | weekly, deterministic |
| 4 | "My ladders" shows a card `This week's pick` with repo name, description (GitHub's one-line description, as text) and a `Learn this` link to `/start?url=https://github.com/<owner>/<name>`. | "Fresh entry points"; FR-015 |
| 5 | When no candidate survives or GitHub fails (rate limit, 5xx), no row is written for that week and the card is hidden; the previous week's pick is not shown as this week's. | boundary; NFR-009 clear failure |
| 6 | No code path reads Idea Radar data: a test asserts the module imports only the app's GitHub client and DB. | "No shared database, login or API" |

---

## Evaluation & Acceptance (How we know the agent worked correctly)

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | Mocked search result of 5 repos: 1 fork, 1 low confidence, 1 picked 3 weeks ago, 2 valid | the higher-star valid repo is picked | vitest |
| 2 | Run twice in the same week | 1 row, same repo | vitest (test DB) |
| 3 | Mock 403 + `x-ratelimit-remaining: 0` | no row; card hidden | vitest + Playwright |
| 4 | Pick stored | card `This week's pick` with `Learn this` href `/start?url=https%3A%2F%2Fgithub.com%2Fo%2Fr` (or the unencoded form T023 documents) | Playwright |
| 5 | Repo description `<b>x</b>` | rendered literally | Playwright |

### Verification Command (exact, runnable)

```bash
pnpm install --frozen-lockfile && pnpm db:migrate && pnpm test -- trending-pick && pnpm test:e2e -- trending-pick && pnpm lint
```

### Evidence (filled by reviewer at Stage 4/5)

> **Moved.** Filled by the reviewer at Stage 4/5 in `tasks/TASK_REVIEW_T029.md`.

---

## Demonstration

> **Moved.** See `tasks/TASK_REVIEW_T029.md`.

---

## UI / Design Acceptance Criteria

### 1. Visual Regression

| Screen / Component | Verification method | Expected result |
|-------------------|---------------------|-----------------|
| "My ladders" with a pick | Playwright screenshot at 1280 px + LLM-vision verdict against AC 4 | `This week's pick` card above the learner's ladders, with repo name, description and `Learn this`; verdict "matches spec" |
| "My ladders" with no pick this week | Playwright screenshot + LLM-vision verdict | no card, no empty gap |

### 2. Design-System Compliance

| Criterion | Verification method | Expected result |
|-----------|---------------------|-----------------|
| Colors match design tokens | computed-style check on the card and link + token lint (no raw hex outside the token file set by T003/T010) | card and link tokens from T010's ladder list |
| Typography matches spec | computed-style check on card title and description | heading / secondary text tokens |
| Spacing / layout matches spec | computed-style check on card padding and gap to the list | existing spacing tokens |

### 3. Layout / Responsiveness

| Viewport | Verification method | Expected result |
|----------|---------------------|-----------------|
| Mobile (360px) | Playwright screenshot + LLM-vision verdict; assert `document.documentElement.scrollWidth <= 360` | full-width card; long repo names wrap |
| Tablet (768px) | Playwright screenshot + LLM-vision verdict | full-width card |
| Desktop (1280px) | Playwright screenshot + LLM-vision verdict | card at the ladder list's width |

---

## Approach

**Pattern reference**: `experiments/core-spike/src/confidence.ts` (`confidenceScore` rule) and `experiments/core-spike/src/github.ts` (rate-limit errors, no partial result) — port the rule, do not import from `experiments/`; T005's GitHub client for token use.

**Vital slice**: the cron pick with filters + the one card.
**Cut list**:
- OSS Insight or any other trend source (GitHub search only)
- pre-generating the picked ladder
- history page of past picks
- push notification of the pick

Candidate scoring needs a README/issues read per candidate: cap at 30 candidates × the 7 calls T001 measured =
≤ 210 calls per week, within the 5,000/h token limit. Dates use UTC; `weekStart` is the Monday 00:00 UTC of the
run. Run `Skill({ skill: "migration-safety" })` for the new `trending_picks` table.

---

## Edge Case Checklist

- [ ] Search returns fewer than 30 repos — score what is returned
- [ ] All candidates picked within 8 weeks — no pick that week (AC 5)
- [ ] Repo renamed between pick and click — `/start?url=` resolves through GitHub's redirect (T005 behaviour)
- [ ] Repo deleted after the pick — card still links; `/start` shows T005's not-found error
- [ ] Cron missed a week (deploy downtime) — the next run picks for its own week only, no backfill
- [ ] Description missing — card shows the repo name only

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| Inngest functions folder (T005, app layout set by T003, see `memory/codebase-map.md` once mapped) | `pickTrendingWeekly` cron |
| new migration in T003's migrations folder | `trending_picks` (unique `weekStart`) |
| "My ladders" page (T003 tracer page) | `This week's pick` card |
| tests `trending-pick` (vitest + Playwright) + mocked search fixtures | AC 1–6 |
| `tasks/TASK_REVIEW_T029.md` | Evidence (reviewer) |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `.claude/**`, `agents/**`, `skills/**`, `templates/**`, `AGENTS.md`, `CLAUDE.md` | kit |
| `PRD.md`, `PROJECT_SPEC.md`, `PROJECT_KANBAN.md` | Supervisor-owned |
| `experiments/**` | throwaway spikes; port, do not import |
| `/start` handler (T005) and `docs/contracts/start-url.md` (T023) | the contract; consume only |
| the Idea Radar repo or data | forbidden by § Architecture |

---

## Test Plan

vitest with mocked GitHub search and repo fixtures for filters, idempotency and failure (Success 1–3).
Playwright for the card and its link, plus the UI section at 360/768/1280 px with LLM-vision verdicts
(Success 4, 5). Real run: trigger `pickTrendingWeekly` once in the Inngest dev server against the live GitHub
API with the dev token, paste the stored row and a screenshot of the card.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run
- [ ] `Skill({ skill: "migration-safety" })` run (new table)
- [ ] Lint passes (`pnpm lint`, `tsc --noEmit`)
- [ ] Tests written AND pass — output pasted into `tasks/TASK_REVIEW_T029.md` Evidence (Hard-Stop Gate 5)
- [ ] UI / Design Evidence rows filled with screenshots and verdicts (Hard-Stop Gate 6)
- [ ] `Skill({ skill: "verify" })` run — headless auto verify
- [ ] Supervisor notified: task ready for Stage 4 review
