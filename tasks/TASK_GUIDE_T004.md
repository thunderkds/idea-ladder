# TASK_GUIDE — T004: Golden set of 20 hand-checked repos, eval harness, per-step cost logging
**Date**: 2026-11-01
**Complexity Level**: C2
**Risk Level**: Low
**Priority**: P0
**Assigned agent**: qa-expert
**Agent guide**: `agents/qa.md`

---

## Mandatory Startup (Do Not Skip)

Before writing any code:
1. Read `PROJECT_SPEC.md`
2. Read the memory slice in your spawn prompt (`<!-- memory-slice -->`). Read `memory/MEMORY.md` in full only if your work reaches a file, hook, skill or decision the slice does not cover
3. Read this file completely
4. Read `agents/qa.md`
5. Note the **Complexity Level** above and apply the matching process from the Complexity matrix in `agents/qa.md`
6. C2: this task has no dependency on T003 and may run before the app exists. Read `memory/codebase-map.md` if it exists; if T003 has merged, follow its layout and add `eval/` to its pnpm workspace. Read `docs/REQUIREMENT_SOURCE.md` § Framework stack (Tracing and evals row), § Alternatives to investigate, § Repo to ladder engine, and `experiments/core-spike/RESULTS.md` § 3 and § Known limits.

---

## Requirement (Pillar 1 — Adapt the requirement)

Requirement § Framework stack, Tracing and evals: "Any LLM tracing tool + a golden set of about 20
hand-checked repos — Catch prompt regressions before learners do". § Alternatives to investigate: "Most tests
run on the golden set of about 20 hand-checked repos"; Models row: "Cost and accuracy per step on the golden
set — Switch if cost per ladder too high". User decision 2026-11-01 (PRD Open Question 5): cost cap "not set;
v1 task measures real cost per ladder on the golden set first".

**Restated intent** (Supervisor's interpretation):
> Build the measuring stick before the generators: 20 public repos pinned to a commit SHA, each with
> hand-checked labels (core files, concepts, expected confidence level), an offline eval harness that scores
> any pipeline step against those labels, and a per-step cost logger that every LLM step calls.

**Out of scope** (what this task explicitly does NOT do):
- Any LLM call or generator (T006–T009 are scored with this harness later).
- Choosing a tracing vendor (cut: the cost log is local JSONL; a tracing tool is added only when a task needs it).
- Setting the cost cap (T017, HITL).
- Labels for questions/MCQs (T009 builds its own independent seed set).

**Requirement Refs**:
- NFR-008: prompt regressions caught on a golden set of ~20 hand-checked repos
- NFR-004: cost — the first learner pays generation (the logger measures that cost)
- PRD Open Question 5: cost measured before a cap is set

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [ ] Restated intent confirmed to match the user's request (by Supervisor / user — not the implementing agent)
- [ ] Domain terms align with `PROJECT_SPEC.md` glossary (`grill-with-docs` run if terminology was fuzzy)
- [ ] Every Acceptance Criterion below traces to a line in the Requirement
- [ ] All Requirement Refs exist in `PRD.md` and are fully covered by the Acceptance Criteria above

> An agent must NOT start implementing until this gate is checked. If anything here is unclear,
> STOP and ask the Supervisor (Karpathy: Think Before Coding).

---

## Dependencies & Reachability

**Depends on**: None
**Entry point**: `pnpm eval` (script in `eval/package.json`); library entry `logStepCost` (imported by T006–T009 and T017)

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | `eval/golden/repos.json` holds exactly 20 public repos. Each entry has `fullName`, a 40-hex `sha`, `tier` (`trending` / `medium` / `lowkey`), `language`, `expectedCoreFiles` (3–10 paths that exist in that SHA's tree), `expectedConcepts` (3–6), `expectedConfidence` (`low` / `medium` / `high`), `checkedBy`, `checkedAt`. A schema test (zod) validates every entry. | golden set of about 20 hand-checked repos |
| 2 | Mix: ≥ 5 repos per tier; ≥ 4 languages; ≥ 4 repos whose recorded snapshot scores `low` with the T001 confidence rule (so the concept fallback is exercised — T001 had none); the 3 v0 repos (`The-Pocket/PocketFlow`, `developit/mitt`, `lukeed/dset`) are included. | Score confidence: thin README → fall back |
| 3 | Fixtures: `pnpm eval:record` reads each repo once through the GitHub API at its pinned SHA (tree, README, topics, languages, dependency files, open issues, `good first issue` labels) into `eval/golden/fixtures/`. Every other script and test runs offline from these fixtures. | pin to a commit SHA; catch regressions before learners do |
| 4 | `scoreCoreFiles(predicted, expected)` returns `{ recall, precision, missed[], extra[] }`; `scoreConcepts(predicted, expected)` returns `{ overlap, missed[], extra[] }` using a normalised slug match. `pnpm eval -- --step <name> --subject <module>` runs a subject over all 20 repos and writes `eval/reports/<step>-<timestamp>.json` + a Markdown summary with per-repo and mean scores. | catch prompt regressions |
| 5 | A deterministic baseline subject (`baseline-readme`: files named in the README plus the dependency-file entry point) runs through `pnpm eval` with no network and no LLM, so every later step has a number to beat. | most tests run on the golden set |
| 6 | `logStepCost({ runId, ladderKey, step, model, inputTokens, outputTokens, cachedInputTokens })` appends one JSON line to the cost log and computes `usd` from `eval/prices.json`. `pnpm eval:cost -- --run <runId>` prints cost per step and per ladder. | cost and accuracy per step on the golden set |
| 7 | Negative: an unknown `model` id (not in `prices.json`) throws `UnknownModelPriceError`; it never logs `usd: 0`. Negative token counts or a missing `step` are rejected. | cost per ladder must be real, not silently zero |
| 8 | Negative: a golden entry whose `expectedCoreFiles` path is not in its fixture tree fails the schema test with the repo and path named. | hand-checked labels |

---

## Evaluation & Acceptance (How we know the agent worked correctly)

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | `eval/golden/repos.json` + fixtures | schema test passes; 20 entries; tier/language/low-confidence counts per AC 2 | vitest |
| 2 | predicted `["a.ts","b.ts"]`, expected `["a.ts","c.ts"]` | `recall 0.5`, `precision 0.5`, `missed ["c.ts"]`, `extra ["b.ts"]` | vitest |
| 3 | `pnpm eval -- --step core-files --subject baseline-readme` with the network blocked | report JSON + Markdown written; 20 rows; exit 0 | command run |
| 4 | `logStepCost` with test price `{ "test-model": { input: 3, output: 15, cachedInput: 0.3 } }` (USD per 1M tokens), 1,000,000 input / 100,000 output tokens | `usd = 4.5` | vitest |
| 5 | `logStepCost` with `model: "not-in-table"` | throws `UnknownModelPriceError` | vitest |
| 6 | golden entry with a core path absent from the tree | schema test fails naming repo + path | vitest (fixture copy) |

### Verification Command (exact, runnable)

```bash
cd eval && pnpm install --frozen-lockfile && pnpm test && pnpm eval -- --step core-files --subject baseline-readme && pnpm eval:cost -- --run test-fixture-run
```

### Evidence (filled by reviewer at Stage 4/5)

> **Moved.** Filled by the reviewer at Stage 4/5 in `tasks/TASK_REVIEW_T004.md`.

---

## Demonstration

> **Moved.** See `tasks/TASK_REVIEW_T004.md`.

---

## Approach

**Pattern reference**: `experiments/core-spike/src/github.ts` + `experiments/core-spike/src/fixture-fetch.ts` — snapshot shape, rate-limit errors, record-once / replay-offline fixtures; `experiments/core-spike/src/confidence.ts` — the confidence rule used for AC 2. Copy the code into `eval/` (do not import from `experiments/`).

**Vital slice**: the 20 labelled repos + `scoreCoreFiles` + the baseline run — the one number T006 must beat.
**Cut list**:
- tracing vendor / dashboard (JSONL log is enough until a task needs traces)
- scoring of generated questions (T009 owns its seed set)
- automatic price fetching (prices are typed in by hand with a source URL and date)
- a web UI for reports (Markdown summary only)

1. Pick repos: mix of tiers, languages and sizes; include small libraries, one monorepo, one repo with thin docs per tier. Pin each to the default-branch HEAD SHA on the day of recording.
2. Labels: for each repo, read the README and tree at the pinned SHA and write `expectedCoreFiles` (the files a reader must open to explain how the core works) and `expectedConcepts`. Write a one-line reason per core file in `eval/golden/notes/<owner>__<name>.md`. Set `checkedBy: "qa-expert"`; the owner's later spot check updates `checkedBy` — not this task.
3. Recording: use `GITHUB_TOKEN` from env if present (5,000 req/h), else unauthenticated (60 req/h; record in batches and stop with `RateLimitError` instead of writing a partial fixture). Never write the token to a fixture.
4. Cost log: one JSON line per LLM step to `eval/cost-log/<runId>.jsonl`. `prices.json` entries carry `source` (URL) and `checkedAt`. Ship only the `test-model` entry plus entries the Supervisor provides for model A; model B's entry is added in T009.
5. Cards and labels are original text; fixtures store GitHub API responses as data for tests only (NFR-006: never copied into cards).

---

## Edge Case Checklist

- [ ] Repo renamed or deleted after recording → fixtures still replay; `eval:record` reports it, does not crash the whole run
- [ ] Default branch not `main` (as `lukeed/dset`) → SHA still resolved
- [ ] Monorepo with > 1,000 tree entries → GitHub tree `truncated: true` is detected and recorded, not silently cut
- [ ] Path labels are case-sensitive (`README.md` vs `readme.md`)
- [ ] Concept slug match: `Rust async` vs `rust-async` match; `embeddings` vs `embedding` documented as match or miss (decide once, test it)
- [ ] Division by zero: empty `predicted` → `precision 0`, not `NaN`
- [ ] Cost: cached input tokens priced separately; a step with 0 tokens logs `usd: 0` only when the model is known
- [ ] Tests never hit the network

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| `eval/package.json`, `eval/pnpm-lock.yaml`, `eval/tsconfig.json` | new eval package (or workspace member if T003 merged first) |
| `eval/golden/repos.json`, `eval/golden/notes/**`, `eval/golden/fixtures/**` | the golden set |
| `eval/src/**` | schema, scorers, harness runner, baseline subject, cost logger |
| `eval/prices.json` | price table |
| `eval/test/**` | AC 1–8 |
| `tasks/TASK_REVIEW_T004.md` | Evidence (reviewer) |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `.claude/**`, `agents/**`, `skills/**`, `templates/**`, `AGENTS.md`, `CLAUDE.md` | kit |
| `PRD.md`, `PROJECT_SPEC.md`, `PROJECT_KANBAN.md`, `BRAINSTORMING_LOG.md`, `memory/**` | Supervisor-owned |
| `experiments/**` | throwaway v0 spikes; copy patterns, do not edit or import |
| app source tree from T003 (except adding `eval` to the workspace file) | owned by T003 / implementers |

---

## Test Plan

vitest: schema test over the real golden file (AC 1, 2, 8), scorer unit tests (AC 4), cost logger unit tests (AC 6, 7), harness test with a 2-repo fixture subset. Real run: `pnpm eval` with the baseline subject on all 20 repos (AC 5); paste the Markdown summary into the review file.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run
- [ ] Lint passes (`tsc --noEmit`)
- [ ] Tests written AND pass — output pasted into `tasks/TASK_REVIEW_T004.md` Evidence (Hard-Stop Gate 5)
- [ ] `Skill({ skill: "verify" })` run — headless auto verify
- [ ] Supervisor notified: task ready for Stage 4 review
