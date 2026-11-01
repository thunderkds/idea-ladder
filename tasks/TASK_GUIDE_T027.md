# TASK_GUIDE — T027: Author credit: "N learners passed your ladder"
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
6. C1: skip `memory/codebase-map.md` unless you cannot find the concept ladder module. Read `tasks/TASK_GUIDE_T026.md` (`authors`, version rows, status `community`) and `tasks/TASK_GUIDE_T012.md` (evidence records).

---

## Requirement (Pillar 1 — Adapt the requirement)

Requirement § Brainstorm: feature ideas: "Author credit: "N learners passed your ladder" — Gives experts a reason to
contribute — v2". Roadmap v3: "author credit". § Grill #5: "Why would experts contribute ladders? — Credit, profiles,
learner counts; expect you to write ~90% at first". PRD persona P3: "Ladder author (v2+) — No reason to contribute;
no credit".

**Restated intent** (Supervisor's interpretation):
> Each community concept ladder shows its authors and a count of distinct learners who passed it, and an author
> sees the same counts for all their ladders, so experts get visible credit for contributing.

**Out of scope** (what this task explicitly does NOT do):
- Names or profiles of the learners who passed (count only).
- Leaderboards, rankings, notifications to authors.
- Credit for AI-drafted (`unverified`) concept ladders — they have no human author.

**Requirement Refs**:
- FR-011: the count is computed from append-only evidence records (passes), not from any other signal
- FR-003: credit applies to community concept ladders that the app reuses
- No FR or US names author credit: PRD persona P3 is the source; PRD § Out of Scope keeps it for after its gate

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [ ] Restated intent confirmed to match the user's request (by Supervisor / user — not the implementing agent)
- [ ] Domain terms align with `PROJECT_SPEC.md` glossary (`grill-with-docs` run if terminology was fuzzy)
- [ ] Every Acceptance Criterion below traces to a line in the Requirement
- [ ] All Requirement Refs exist in `PRD.md` and are fully covered by the Acceptance Criteria above

> An agent must NOT start implementing until this gate is checked. If anything here is unclear,
> STOP and ask the Supervisor (Karpathy: Think Before Coding).

---

## Dependencies & Reachability

**Depends on**: T026 — community concept ladders with `authors` and version rows exist in the app; T012 — passing evidence records exist to count; T019 — revoked credentials are excluded from the learner count
**Entry point**: `learnersPassedCount` (service function); UI text `learners passed your ladder`

> v3 task: planned only. Pickup waits for Gate 3 ("Proof links get shared; first outside ladder PR").

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | `learnersPassedCount(conceptLadderId)` returns the number of distinct learners with at least one passing evidence record for that concept ladder's test, summed over all its versions. | ""N learners passed your ladder"" |
| 2 | The count excludes the ladder's own authors and learners whose passing record belongs to a revoked credential (T019 status list) where one exists. | credit that means something |
| 3 | The concept ladder view shows `By <author logins>` and `N learners passed this ladder`; a signed-in author sees on their ladders `N learners passed your ladder` (singular `1 learner passed your ladder`; `0` shows `No learners have passed yet`). | "Author credit"; boundary 0 / 1 |
| 4 | AI-drafted (`unverified`) concept ladders show no author line and no count. | out of scope rule |
| 5 | The count is a single SQL query (indexed); for a ladder with 10,000 passing records the query runs under 50 ms on the test DB. | the UI must not slow the ladder view |
| 6 | The UI shows only the number, never learner names or logins. | privacy |

---

## Evaluation & Acceptance (How we know the agent worked correctly)

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | 3 learners pass v1, 1 of them passes v2 too, 1 author passes | count = 3 | vitest (test DB) |
| 2 | One learner's pass belongs to a revoked credential | count drops by 1 | vitest |
| 3 | Count 1 / 0 | `1 learner passed your ladder` / `No learners have passed yet` | Playwright |
| 4 | `unverified` concept ladder | no author line, no count | Playwright |
| 5 | 10,000 seeded passing records | query < 50 ms (`EXPLAIN ANALYZE` pasted) | vitest + command run |

### Verification Command (exact, runnable)

```bash
pnpm install --frozen-lockfile && pnpm db:migrate && pnpm test -- author-credit && pnpm test:e2e -- author-credit && pnpm lint
```

### Evidence (filled by reviewer at Stage 4/5)

> **Moved.** Filled by the reviewer at Stage 4/5 in `tasks/TASK_REVIEW_T027.md`.

---

## Demonstration

> **Moved.** See `tasks/TASK_REVIEW_T027.md`.

---

## UI / Design Acceptance Criteria

### 1. Visual Regression

| Screen / Component | Verification method | Expected result |
|-------------------|---------------------|-----------------|
| concept ladder view — author line + count | Playwright screenshot at 1280 px + LLM-vision verdict against AC 3 | `By <logins>` and the count sit under the ladder title; verdict "matches spec" |
| author's own ladder — `N learners passed your ladder` | Playwright screenshot + LLM-vision verdict | text visible to the author only |
| `unverified` concept ladder | Playwright screenshot + LLM-vision verdict | no author line, no count, no empty gap |

### 2. Design-System Compliance

| Criterion | Verification method | Expected result |
|-----------|---------------------|-----------------|
| Colors match design tokens | computed-style check on the credit line + token lint (no raw hex outside the token file set by T003/T010) | muted text token from T010's ladder view |
| Typography matches spec | computed-style check (`font-size`, `font-weight`) | secondary text token, smaller than the ladder title |
| Spacing / layout matches spec | computed-style check on margin under the title | existing spacing token |

### 3. Layout / Responsiveness

| Viewport | Verification method | Expected result |
|----------|---------------------|-----------------|
| Mobile (360px) | Playwright screenshot + LLM-vision verdict; assert `document.documentElement.scrollWidth <= 360` | credit line wraps under the title; long author lists wrap |
| Tablet (768px) | Playwright screenshot + LLM-vision verdict | one line where it fits |
| Desktop (1280px) | Playwright screenshot + LLM-vision verdict | one line under the title |

---

## Approach

**Pattern reference**: T010's ladder view header for placement and tokens; T019's status list lookup for the revoked exclusion.

**Vital slice**: the count query + the one line on the concept ladder view.
**Cut list**:
- per-version counts (summed only)
- author dashboard page (the line on each ladder is enough)
- caching layer (query is indexed; add a cache only if AC 5 fails)

Count from evidence records only, joined to concept ladder versions; add an index on (concept ladder id,
learner id) for passing records if missing, through a migration (`Skill({ skill: "migration-safety" })`, additive
index). Author identity is the GitHub login from T025's `authors`, matched to the signed-in learner's login,
case-insensitive.

---

## Edge Case Checklist

- [ ] Same learner passes several versions — counted once
- [ ] Author also listed with different case in `authors` — still excluded
- [ ] Learner account deleted — their records still count (append-only); no login shown anyway
- [ ] Ladder retired (T026) — count still shown on the ladder for existing learners
- [ ] Credential tables from T019 not present at pickup — the revoked exclusion is skipped and the gap is reported, not faked
- [ ] Learner passes, fails a retake, passes again — counted once

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| concept ladder module from T022/T026 (app layout set by T003, see `memory/codebase-map.md` once mapped) | `learnersPassedCount` |
| concept ladder view component (T010 layout) | author line + count text |
| new migration in T003's migrations folder (only if the index is missing) | index on passing evidence records |
| tests `author-credit` (vitest + Playwright) | AC 1–6 |
| `tasks/TASK_REVIEW_T027.md` | Evidence (reviewer) |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `.claude/**`, `agents/**`, `skills/**`, `templates/**`, `AGENTS.md`, `CLAUDE.md` | kit |
| `PRD.md`, `PROJECT_SPEC.md`, `PROJECT_KANBAN.md` | Supervisor-owned |
| `experiments/**` | throwaway spikes |
| evidence record table and writer (T012) | append-only; read only |
| `community-ladders/**` | T025's content repo |

---

## Test Plan

vitest integration tests on the test DB for the count rules and the 10,000-record timing (Success 1, 2, 5).
Playwright for the text variants and the UI section at 360/768/1280 px with LLM-vision verdicts (Success 3, 4).
Real run: open a synced community ladder in the dev app, paste the screenshot.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run
- [ ] Lint passes (`pnpm lint`, `tsc --noEmit`)
- [ ] Tests written AND pass — output pasted into `tasks/TASK_REVIEW_T027.md` Evidence (Hard-Stop Gate 5)
- [ ] UI / Design Evidence rows filled with screenshots and verdicts (Hard-Stop Gate 6)
- [ ] `Skill({ skill: "verify" })` run — headless auto verify
- [ ] Supervisor notified: task ready for Stage 4 review
