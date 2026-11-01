# TASK_GUIDE — T025: Community ladders content repo with CI schema validation
**Date**: 2026-11-01
**Complexity Level**: C2
**Risk Level**: Medium
**Priority**: P1
**Assigned agent**: common-infrastructure
**Agent guide**: `agents/common-infrastructure.md`

---

## Mandatory Startup (Do Not Skip)

Before writing any code:
1. Read `PROJECT_SPEC.md`
2. Read the memory slice in your spawn prompt (`<!-- memory-slice -->`). Read `memory/MEMORY.md` in full only if your work reaches a file, hook, skill or decision the slice does not cover
3. Read this file completely
4. Read `agents/common-infrastructure.md`
5. Note the **Complexity Level** above and apply the matching process from the Complexity matrix in `agents/common-infrastructure.md`
6. C2: read `memory/codebase-map.md` (the app layout set by T003, once mapped). Read `tasks/TASK_GUIDE_T022.md` (concept ladder data model the content must map to), `experiments/v0-kit/` (the L0–L4 ladder template used in v0), and `docs/REQUIREMENT_SOURCE.md` § Repo to ladder engine, § Grill #5, #9, #10.

---

## Requirement (Pillar 1 — Adapt the requirement)

Requirement § Brainstorm: feature ideas: "Community ladders in a Git repo, CI-validated — Growth engine, like
roadmap.sh — v2". Architecture diagram: "Content repo (community ladders, CI) → Ladder API". Roadmap v3:
"Ladders repo + CI". § Repo to ladder engine: "ladder per concept scales and lets the community improve one shared
ladder". § Grill #9: "Copyright on repo code and docs? — Link out; cards are original text only". § Grill #10:
"Money or health ladders giving bad advice? — Concepts and mechanics only, required citations, stricter review".
Gate 3: "first outside ladder PR".

**Restated intent** (Supervisor's interpretation):
> Create the content repo scaffold where each concept ladder is one file in a fixed schema, and a CI workflow
> that rejects any pull request whose ladder files break the schema or the content rules, so outside authors
> can open ladder PRs that the app can later sync safely.

**Out of scope** (what this task explicitly does NOT do):
- Creating the GitHub remote, its permissions, branch protection or CODEOWNERS on GitHub (user action; T026 reads the repo name from config).
- Syncing ladders into the app (T026); author credit (T027).
- Writing more than 2 example ladders (seed content is the owner's job: "expect you to write ~90% at first").
- Any check that needs an LLM.

**Requirement Refs**:
- FR-003: existing (community) concept ladders are reused — this task defines their source format
- NFR-006: cards are original text only; repo code and docs are linked, not copied
- No FR names the content repo itself: PRD § Out of Scope keeps "community ladders repo" for after its gate; this guide is planned for that phase

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [ ] Restated intent confirmed to match the user's request (by Supervisor / user — not the implementing agent)
- [ ] Domain terms align with `PROJECT_SPEC.md` glossary (`grill-with-docs` run if terminology was fuzzy)
- [ ] Every Acceptance Criterion below traces to a line in the Requirement
- [ ] All Requirement Refs exist in `PRD.md` and are fully covered by the Acceptance Criteria above

> An agent must NOT start implementing until this gate is checked. If anything here is unclear,
> STOP and ask the Supervisor (Karpathy: Think Before Coding).

---

## Dependencies & Reachability

**Depends on**: T022 — the concept ladder data model (slug, title, version, L0 test, status) that each content file must map to one-to-one
**Entry point**: `pnpm validate-ladders` (script in the content repo scaffold's `package.json`, run by its CI workflow `validate-ladders`)

> v3 task: planned only. Pickup waits for Gate 3 ("Proof links get shared; first outside ladder PR"). Gate 3 counts an outside ladder PR, which needs this repo: the Supervisor settles that order with the user before pickup.

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | The scaffold lives in `community-ladders/` as a self-contained repo root (own `package.json`, lockfile, `README.md`, `CONTRIBUTING.md`, `LICENSE`, `.github/workflows/validate-ladders.yml`), so it can be pushed as its own GitHub repo unchanged. | "Community ladders in a Git repo" |
| 2 | One file per concept ladder at `ladders/<slug>.yaml`, validated by a JSON Schema `schema/concept-ladder.schema.json` with `schemaVersion`; required: `slug` (equals the file name), `title`, `version` (integer), `authors` (GitHub logins), `levels` L0–L4 each with `goal`, `passTest` and `cards[]`, and `sources[]` (URLs) per card. | "CI-validated"; maps to T022's model |
| 3 | `pnpm validate-ladders` exits 0 on the 2 example ladders and non-zero with `<file>:<path>: <message>` lines on each fixture in `test/invalid/` (missing level, slug ≠ file name, duplicate card id, card without a source, non-HTTPS source, unknown field). | "CI-validated" |
| 4 | Content rules beyond the schema: a card text longer than 600 characters, a fenced code block longer than 5 lines, or a card that repeats ≥ 200 consecutive characters of a linked source fixture fails with rule id `original-text`. | NFR-006 / § Grill #9 "cards are original text only" |
| 5 | A ladder whose `topics` include a sensitive field (`money`, `health`, `medical`, `legal`) must give every card a `sources[]` entry and the PR gets the label `stricter-review` from the workflow; missing sources fail. | § Grill #10 "required citations, stricter review" |
| 6 | The CI workflow runs on `pull_request` with read-only permissions (`permissions: contents: read`, plus `pull-requests: write` only for the label step), pins every action to a commit SHA, and never runs code from the PR outside the validator (no `pull_request_target`). | safe CI for outside PRs |
| 7 | Bumping `version` is required when an existing ladder's `levels` change: the workflow compares with the base branch and fails `version-not-bumped` otherwise. | learner progress is tied to a version (T022 AC 6) |

---

## Evaluation & Acceptance (How we know the agent worked correctly)

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | 2 example ladders | exit 0 | `pnpm validate-ladders` |
| 2 | Each `test/invalid/*.yaml` fixture | non-zero, one `<file>:<path>: <message>` line naming the expected rule | vitest |
| 3 | Card copying 250 chars of a source fixture | `original-text` failure | vitest |
| 4 | `money` topic ladder with a card missing `sources` | failure | vitest |
| 5 | Changed `levels` with the same `version` vs a base copy | `version-not-bumped` | vitest (two directories) |
| 6 | Workflow file | `actionlint` passes; every `uses:` is a 40-hex SHA; no `pull_request_target` | `pnpm lint:workflow` |

### Verification Command (exact, runnable)

```bash
cd community-ladders && pnpm install --frozen-lockfile && pnpm test && pnpm validate-ladders && pnpm lint:workflow
```

### Evidence (filled by reviewer at Stage 4/5)

> **Moved.** Filled by the reviewer at Stage 4/5 in `tasks/TASK_REVIEW_T025.md`.

---

## Demonstration

> **Moved.** See `tasks/TASK_REVIEW_T025.md`.

---

## Approach

**Pattern reference**: `experiments/v0-kit/` — the L0–L4 ladder structure and card style already used in v0 (read, do not import); T022's `concept_ladders` model for field names.

**Vital slice**: the schema + `pnpm validate-ladders` + the CI workflow on `pull_request`.
**Cut list**:
- a website rendering the ladders (roadmap.sh style)
- automated similarity check against the live web (only against linked source fixtures)
- CODEOWNERS / branch protection (GitHub settings, user action)
- translations

YAML for authors (readable diffs), JSON Schema (draft 2020-12) validated with `ajv`, `yaml` parser — exact
versions pinned, published at least 2 weeks before pickup. The schema file is the contract T026 vendors by
`schemaVersion`, so keep it in one file. The `original-text` rule is a heuristic against copying, not a proof;
`CONTRIBUTING.md` states the rule in plain words. Hard-Stop Gate 4 check: the content repo holds content and one
validator, no new tech scope, so it stays on this board; if the user makes it a separately managed project, the
Supervisor moves it to its own board.

---

## Edge Case Checklist

- [ ] YAML anchors/aliases used to blow up size — parser with alias limit; files > 200 KB fail
- [ ] Two files with the same `slug` in different case on a case-insensitive FS — fail `duplicate-slug`
- [ ] Unicode look-alike slug (`vеctor` with Cyrillic е) — slug restricted to `[a-z0-9-]`
- [ ] New ladder (no base version) — `version-not-bumped` rule skipped
- [ ] Deleted ladder file in a PR — allowed; T026 retires it, never deletes progress
- [ ] Source URL to a private or non-HTTPS host — fail
- [ ] PR from a fork — workflow still runs read-only; label step skipped with a notice when the token cannot write

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| `community-ladders/package.json`, lockfile, `tsconfig.json` | new self-contained repo root |
| `community-ladders/schema/concept-ladder.schema.json` | the contract (with `schemaVersion`) |
| `community-ladders/src/validate.ts`, `community-ladders/src/rules/*.ts` | schema + content rules |
| `community-ladders/ladders/*.yaml` | 2 example ladders (original text) |
| `community-ladders/test/**` | invalid fixtures, rule tests |
| `community-ladders/.github/workflows/validate-ladders.yml` | CI on `pull_request` |
| `community-ladders/README.md`, `CONTRIBUTING.md`, `LICENSE` | how to contribute; licence picked by the user (stop and ask if not given) |
| `tasks/TASK_REVIEW_T025.md` | Evidence (reviewer) |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `.claude/**`, `agents/**`, `skills/**`, `templates/**`, `AGENTS.md`, `CLAUDE.md` | kit |
| `PRD.md`, `PROJECT_SPEC.md`, `PROJECT_KANBAN.md` | Supervisor-owned |
| `experiments/**` | throwaway spikes; v0 kit is read-only reference |
| the app's source and migrations | this task touches only `community-ladders/` |
| the main repo's own CI workflows | the content repo has its own workflow |

---

## Test Plan

vitest unit tests per rule with valid and invalid fixtures (Success 2–5); `pnpm validate-ladders` on the
examples (Success 1); `actionlint` on the workflow (Success 6). Real run: run the workflow locally with `act` if
available, otherwise paste the validator output on a deliberately broken branch copy.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run
- [ ] Security review: `Skill({ skill: "security-review" })` run (Medium risk — CI on outside PRs)
- [ ] Lint passes (`pnpm lint`, `tsc --noEmit`, `actionlint`)
- [ ] Tests written AND pass — output pasted into `tasks/TASK_REVIEW_T025.md` Evidence (Hard-Stop Gate 5)
- [ ] `Skill({ skill: "verify" })` run — headless auto verify
- [ ] Supervisor notified: task ready for Stage 4 review
