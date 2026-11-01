# TASK_GUIDE — T002: v0 experiment kit — 3 ladders, Anki import file, 14-day log
**Date**: 2026-11-01
**Complexity Level**: C1
**Risk Level**: Low
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
6. Read `docs/REQUIREMENT_SOURCE.md` § Repo to ladder engine (the L0–L4 table), § Daily loop, § First experiment and kill criteria, § Grill #9 (copyright).

---

## Requirement (Pillar 1 — Adapt the requirement)

"Validate with zero code in 2 weeks: hand-make 3 ladders and climb one. Pick 3 repos from Idea Radar: one
trending, one medium, one lowkey. Ask Claude to generate each ladder using the L0 to L4 template above. Put
the cards into Anki (FSRS on) as a stand-in for the app. Climb one ladder for 14 days, 5 to 15 minutes a day.
Log each day: did review happen, did a level pass, what felt useless." Plus the kill-criteria table
(Daily review, Ladder quality, Lowkey repo, Pass tests, Pull).

**Restated intent** (Supervisor's interpretation):
> Produce everything the owner needs to start the 14-day v0 run today: one ladder per repo
> (`The-Pocket/PocketFlow` trending, `developit/mitt` medium, `lukeed/dset` lowkey), each L0–L4 with goal,
> pass test and review cards; one Anki-importable file per ladder; and a 14-day log with the kill criteria.

**Out of scope**:
- Any app, server or scheduler (Anki is the app in v0).
- Climbing the ladder (the owner does that for 14 days).
- Copying repo code or docs into cards (cards are original text; link out).

**Requirement Refs**:
- FR-017: v0 zero-code experiment kit
- FR-004: L0–L4 levels with pass tests (as content)
- FR-005: lowkey repo uses the concept fallback when thin
- NFR-006: original text only

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [x] Restated intent confirmed to match the user's request — auto (Supervisor), 2026-11-01
- [x] Domain terms align with `PROJECT_SPEC.md` § Glossary
- [x] Every Acceptance Criterion below traces to a line in the Requirement
- [x] All Requirement Refs exist in `PRD.md` and are covered by the Acceptance Criteria

---

## Dependencies & Reachability

**Depends on**: None
**Entry point**: `node experiments/v0-kit/build-anki.mjs`

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | `experiments/v0-kit/ladders/{pocketflow,mitt,dset}.md` exist. Each has the repo full name and the commit SHA it was read at, and sections `L0 Prerequisites` … `L4 Rebuild or contribute`, each with **Goal**, **Pass test (proof)** and a `cards` table (`Front | Back`). | "hand-make 3 ladders … L0 to L4 template" |
| 2 | Every level has ≥ 3 cards; every card's Back is original text ≤ 300 chars, with no fenced code block and no line copied verbatim from the repo README. | daily review cards; Grill #9 |
| 3 | `dset.md` states its confidence (thin README / few issues) and uses concept-only L0–L1 content where the repo is thin, saying so. | "Lowkey repo: concept fallback still gives a usable path" |
| 4 | `node experiments/v0-kit/build-anki.mjs` writes `experiments/v0-kit/anki/<ladder>.txt` per ladder in Anki's plain-text import format: header lines `#separator:tab`, `#html:false`, `#tags column:3`, then `Front<TAB>Back<TAB>Tags` with tags `idea-ladder <ladder> L<n>`. | "Put the cards into Anki (FSRS on)" |
| 5 | The build script fails (exit code ≠ 0, message names the file and card) when a field contains a tab or newline, when a level has < 3 cards, or when a level section is missing. | negative case |
| 6 | `experiments/v0-kit/LOG.md` has a 14-row daily table (day, date, review done y/n, minutes, level passed, what felt useless) and the kill-criteria table copied from the source, plus a Gate 1 verdict line to fill on day 14. | "Log each day …" + kill criteria |
| 7 | `experiments/v0-kit/README.md` gives the owner the exact steps: import each `.txt` in Anki (File → Import), turn FSRS on (Deck options → FSRS), which ladder to climb (recommend one), daily routine 5–15 min. | owner can start today |

---

## Evaluation & Acceptance

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | the 3 ladder files | build script exits 0, writes 3 `.txt` files, card count printed per ladder | `node --test` + run |
| 2 | a fixture ladder with a tab inside a Back field | exit ≠ 0, message names file + card | `node --test` |
| 3 | a fixture ladder missing `L3` | exit ≠ 0 | `node --test` |
| 4 | a fixture ladder with a level of 2 cards | exit ≠ 0 | `node --test` |

### Verification Command (exact, runnable)

```bash
node --test experiments/v0-kit/test/ && node experiments/v0-kit/build-anki.mjs && head -5 experiments/v0-kit/anki/*.txt
```

### Evidence (filled by reviewer at Stage 4/5)

> Filled by the reviewer at Stage 4/5 in `tasks/TASK_REVIEW_T002.md`.

---

## Demonstration

> See `tasks/TASK_REVIEW_T002.md`.

---

## Approach

**Pattern reference**: `None — no comparable prior art in this repo` (blank scaffold)

**Vital slice**: the ladder to be climbed (recommend `developit/mitt`: small TypeScript core, L4 rebuild is realistic in 14 days) with full cards; the other two ladders complete but may be leaner (≥ 3 cards per level still holds).
**Cut list**:
- `.apkg` generation (plain-text import is enough and needs no dependency)
- automated README-overlap detection beyond an exact-line check

Read each repo once through the unauthenticated GitHub API (`/repos/{o}/{r}`, `/commits/{branch}`, `/readme`, `/topics`, `/languages`, issues with label `good first issue`) to ground the ladder and record the SHA. Budget ≤ 10 calls per repo; check `x-ratelimit-remaining` first (another task uses the same 60/h budget). The build script uses only Node built-ins (`node:fs`, `node:path`, `node:test`).

---

## Edge Case Checklist

- [ ] Tab or newline inside a card field → hard fail, never silently replaced
- [ ] Markdown table pipes inside a card (`\|`) are unescaped correctly
- [ ] Default branch `master` for `lukeed/dset`
- [ ] Rate limit reached → stop and say so; do not invent a SHA
- [ ] Cards are original; L1–L4 pass tests point at artifacts (log, branch, PR), never at an AI grade

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| `experiments/v0-kit/**` | new kit |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `.claude/**`, `agents/**`, `skills/**`, `templates/**`, `AGENTS.md`, `CLAUDE.md` | kit |
| `PRD.md`, `PROJECT_SPEC.md`, `BRAINSTORMING_LOG.md`, `PROJECT_KANBAN.md` | Supervisor-owned |
| `experiments/core-spike/**` | T001 |
| `docs/archive/**` | another project's archived board |

---

## Test Plan

`node --test experiments/v0-kit/test/` for the build script (happy path on the 3 real ladders + 3 negative fixtures); then the real run of the build script.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run
- [ ] Tests written AND pass — output pasted into `tasks/TASK_REVIEW_T002.md` Evidence (Hard-Stop Gate 5)
- [ ] `Skill({ skill: "verify" })` run — headless auto verify
- [ ] Supervisor notified: task ready for Stage 4 review
