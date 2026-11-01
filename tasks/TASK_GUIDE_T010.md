# TASK_GUIDE — T010: Ladder view — L0–L4, locked levels, status unverified, link out to README/DeepWiki
**Date**: 2026-11-01
**Complexity Level**: C2
**Risk Level**: Low
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
6. C2: read `memory/codebase-map.md` for the app layout set by T003 and the `ladders` table added by T005. Read `docs/decisions/0001-web-framework.md` (T003), `docs/REQUIREMENT_SOURCE.md` § Repo to ladder engine (L0–L4 table), § LLM strategy (Explain the repo row), § Vision flow, and `docs/MAIN_FLOW.md` § 3.

---

## Requirement (Pillar 1 — Adapt the requirement)

§ Repo to ladder engine, L0–L4 table: "L0 Prerequisites — Concepts you're missing — Concept ladder tests";
"L1 Run it — Clone, run, explain what it does — Screenshot or log + 3-sentence explanation"; "L2 Modify —
Change or add one small feature — Branch or diff link + questions generated from your diff"; "L3 Understand —
Explain how the core works — Verified MCQs on core files"; "L4 Rebuild or contribute — Minimal version from
scratch, or a merged PR — Repo link or PR link". § Vision: "unlock each level only by passing its test".
"Reuse or draft concept ladders: … missing ones are AI-drafted and marked unverified." § LLM strategy:
"Explain the repo — No — Link to README, official docs or DeepWiki". § Vision flow: "Ladder L0 to L4 (pinned to
a commit SHA)".

**Restated intent** (Supervisor's interpretation):
> A signed-in learner opens a ladder and sees its five levels L0–L4 with each level's goal and pass test. Only
> the first level not yet passed is open; later levels show as locked. The page shows the ladder's status
> (`unverified`) and the commit SHA it is pinned to, and links out to the repo README at that SHA and to
> DeepWiki instead of explaining the repo.

**Out of scope** (what this task explicitly does NOT do):
- Taking a pass test or passing a level (T012, T013): this task only displays lock state.
- Review cards and the daily review (T011).
- Any repo explanation written by the app (requirement: link out only).
- Generating ladders (T005–T009); concept editing (T007 has its own screen, linked from here).

**Requirement Refs**:
- US-001: get a ladder L0–L4 for a repo
- US-003: a level unlocks only after the learner passes its test (lock state shown)
- FR-004: levels L1–L4 with their pass tests (displayed)
- FR-003: drafted ladder marked `unverified` (status shown)

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [ ] Restated intent confirmed to match the user's request (by Supervisor / user — not the implementing agent)
- [ ] Domain terms align with `PROJECT_SPEC.md` glossary (`grill-with-docs` run if terminology was fuzzy)
- [ ] Every Acceptance Criterion below traces to a line in the Requirement
- [ ] All Requirement Refs exist in `PRD.md` and are fully covered by the Acceptance Criteria above

> An agent must NOT start implementing until this gate is checked. If anything here is unclear,
> STOP and ask the Supervisor (Karpathy: Think Before Coding).

---

## Dependencies & Reachability

**Depends on**: T005 — `ladders` table keyed by repo + commit SHA, `/start` redirect to the ladder on a cache hit, and job status for ladders not yet saved
**Entry point**: route `/ladders/:ladderId`; loader `getLadderView`; link label `Open ladder` on the T003 `My ladders` list

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | `getLadderView(ladderId, userId)` returns `{ repoFullName, commitSha, status, levels: [{ id: "L0".."L4", title, goal, passTest: { kind, description }, lock: "open" | "locked" | "passed" }] }`. Level rows written by T008 are used when present; when a ladder has no level rows yet, the fixed titles and pass-test kinds of the L0–L4 table are shown with goal text `Not generated yet`. | L0–L4 table |
| 2 | `levelLockState(passedLevelIds)` is a pure function: every passed level is `passed`; the first level not passed is `open`; all later levels are `locked`. With no passes: L0 `open`, L1–L4 `locked`. All five passed → all `passed`. Passes recorded out of order (e.g. L2 without L1) do not open L3 — locks follow the first gap. | unlock each level only by passing its test |
| 3 | The page shows the 5 levels in order L0 → L4, each with title, goal and pass-test description. A locked level shows a lock icon with the text `Locked — pass L<n-1> first`, is not a link, and has `aria-disabled="true"`; the open level is visually marked and keyboard-focusable. | locked levels |
| 4 | A status badge shows `Unverified` when `status = "unverified"`, with a tooltip/description `AI-drafted, not yet reviewed by people`. The pinned SHA is shown as its first 7 characters. | marked unverified; pinned to a commit SHA |
| 5 | Link out: `Read the README` → `https://github.com/<owner>/<name>/blob/<commitSha>/README.md`; `Open in DeepWiki` → `https://deepwiki.com/<owner>/<name>`. Both open in a new tab with `rel="noopener noreferrer"`. The page contains no AI-written explanation of the repo. | Explain the repo — No — link to README or DeepWiki |
| 6 | Negative: unknown `ladderId` → 404 page; signed out → redirect to sign-in and back to the same ladder. | accounts from day one (T003) |
| 7 | `My ladders` (T003) lists the saved ladders whose generation job the learner started (`generation_jobs.started_by`, T005), each with an `Open ladder` link to `/ladders/:ladderId`; the empty state stays `No ladders yet`. | US-001 |

---

## Evaluation & Acceptance (How we know the agent worked correctly)

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | `levelLockState([])` | `[open, locked, locked, locked, locked]` | vitest |
| 2 | `levelLockState(["L0","L2"])` | `[passed, open, passed, locked, locked]` | vitest |
| 3 | `levelLockState(["L0","L1","L2","L3","L4"])` | all `passed` | vitest |
| 4 | Seeded ladder `developit/mitt@6b41670516ed8e8b738612f60491995470aa63b3`, status `unverified`, 5 level rows | page shows 5 levels, badge `Unverified`, SHA `6b41670`, README link with full SHA, DeepWiki link | Playwright e2e |
| 5 | Same ladder, keyboard only | Tab reaches the open level; locked levels are skipped as links and announce `aria-disabled` | Playwright e2e + axe accessibility scan (0 violations of serious/critical) |
| 6 | `GET /ladders/does-not-exist` | 404 page | Playwright e2e |
| 7 | Ladder row with no level rows | 5 levels with `Not generated yet` goals | vitest (loader) |

### Verification Command (exact, runnable)

```bash
docker compose up -d db
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm typecheck && pnpm lint
pnpm test -- ladder-view level-lock-state
pnpm test:e2e -- ladder-view
```

### Evidence (filled by reviewer at Stage 4/5)

> **Moved.** Filled by the reviewer at Stage 4/5 in `tasks/TASK_REVIEW_T010.md`.

---

## Demonstration

> **Moved.** See `tasks/TASK_REVIEW_T010.md`.

---

## UI / Design Acceptance Criteria

> Screen: `/ladders/:ladderId`, plus the `Open ladder` rows on `My ladders`. Check against the tokens file created in T003.

### 1. Visual Regression

| Screen / Component | Verification method | Expected result |
|-------------------|---------------------|-----------------|
| Ladder view, no passes (L0 open, L1–L4 locked) | Playwright screenshot + LLM-vision verdict against AC 3–5; baseline stored | 5 levels in order, L0 clearly open, 4 locked with lock icon and text, `Unverified` badge, SHA, two link-out buttons |
| Ladder view, L0–L1 passed | Playwright screenshot + LLM-vision verdict | L0/L1 marked passed, L2 open, L3/L4 locked |
| `My ladders` with 2 ladders | Playwright screenshot + LLM-vision verdict against AC 7 | two rows, each with repo name and `Open ladder` |

### 2. Design-System Compliance

| Criterion | Verification method | Expected result |
|-----------|---------------------|-----------------|
| Colors match design tokens | Playwright computed-style check of open / locked / passed level cards and the badge | values from the T003 tokens file; locked text contrast ≥ 4.5:1 (axe) |
| Typography matches spec | computed `font-family`, `font-size`, `font-weight` of level titles, goals, badge | T003 type scale |
| Spacing / layout matches spec | computed `gap` / `padding` of the level list and cards | T003 spacing scale |

### 3. Layout / Responsiveness

| Viewport | Verification method | Expected result |
|----------|---------------------|-----------------|
| Mobile (360px) | Playwright screenshot at 360×740 + LLM-vision verdict; `scrollWidth <= 360` | levels stacked vertically, link-out buttons full-width, no horizontal scroll |
| Tablet (768px) | Playwright screenshot at 768×1024 + LLM-vision verdict | stacked levels, header with badge and SHA on one line |
| Desktop (1280px) | Playwright screenshot at 1280×800 + LLM-vision verdict | readable max-width column; link-out buttons beside the header |

---

## Approach

**Pattern reference**: T003's `/ladders` page — page structure, session guard, tokens usage; T005's `/jobs/:jobId` page — loader + status text conventions.

**Vital slice**: `levelLockState` + the ladder page showing L0–L4 with lock state, badge and the two link-outs.
**Cut list**:
- level detail pages (each level's own page comes with T011/T012)
- persisting passes (T012 writes them; until then `passedLevelIds` comes from an empty list or test seeds)
- progress bar / percentages
- ladder sharing (v2 proof profile)
- listing ladders reached only by a cache hit on `/start` (needs a backend write in T005's hit path)

1. `levelLockState` lives in shared code so T012's server-side unlock check can call the same function (one rule, one place).
2. The loader reads `ladders` and, when present, T008's `levels`; it never calls an LLM or GitHub.
3. README link uses the full pinned SHA, so the learner reads the same commit the ladder was built from.
4. `My ladders` reads `generation_jobs.started_by` joined to `ladders`. A learner who reached a ladder only through a cache hit is not listed yet (cut list); report it to the Supervisor as a follow-up for the backend.

---

## Edge Case Checklist

- [ ] Repo name with dots or dashes (`The-Pocket/PocketFlow`, `vercel/next.js`) → links encoded correctly
- [ ] README not at the root or named `readme.md` → link uses the path stored in the T005 snapshot when it exists, else `README.md`
- [ ] Ladder with `fallbackToConcepts` (T008 `concept-only-skipped` levels) → L1–L4 show `Concept-only ladder: this level is not generated for this repo`
- [ ] Repo name with HTML characters is escaped
- [ ] Very long goal text → wraps, no overflow at 360px
- [ ] Learner B opens learner A's ladder (shared cache) → sees the same levels with B's own lock state

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| app page `/ladders/:ladderId` and its loader `getLadderView` (layout set by T003) | ladder view |
| shared module for `levelLockState` | lock rule |
| T003 `My ladders` page | list rows with `Open ladder` (empty state unchanged) |
| tests (vitest + Playwright + axe) | AC 1–7 |
| `tasks/TASK_REVIEW_T010.md` | Evidence (reviewer) |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `.claude/**`, `agents/**`, `skills/**`, `templates/**`, `AGENTS.md`, `CLAUDE.md` | kit |
| `PRD.md`, `PROJECT_SPEC.md`, `PROJECT_KANBAN.md`, `BRAINSTORMING_LOG.md`, `memory/**` | Supervisor-owned |
| `experiments/**` | throwaway spikes |
| `eval/**` | T004 |
| `ladder-generate` Inngest function and T005–T009 server modules | backend-owned; this task only reads their tables |
| existing migrations | owned by earlier tasks |

---

## Test Plan

vitest for `levelLockState` (all lock cases, out-of-order passes) and `getLadderView` (with and without level rows, fallback ladder); Playwright e2e on seeded ladders for AC 3–7 with screenshots at 360/768/1280 px and an axe scan. Real run: `pnpm dev`, open a seeded ladder, click both link-outs, paste the screenshots' LLM-vision verdicts.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run
- [ ] Lint passes (`pnpm lint`, `pnpm typecheck`)
- [ ] Tests written AND pass — output pasted into `tasks/TASK_REVIEW_T010.md` Evidence (Hard-Stop Gate 5)
- [ ] `Skill({ skill: "verify" })` run — headless auto verify
- [ ] Supervisor notified: task ready for Stage 4 review
