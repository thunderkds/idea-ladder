# TASK_GUIDE — T008: Level generators in parallel from grounded chunks; answer-key code check; embedding dedupe; save ladder unverified
**Date**: 2026-11-01
**Complexity Level**: C3
**Risk Level**: Medium
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
5. Note the **Complexity Level** above and apply the matching process from the Complexity matrix in `agents/backend.md`: C3 → `Skill({ skill: "brainstorming" })` is mandatory, decompose into the subtasks listed under Approach, adversarial `verify`
6. C3: read `memory/codebase-map.md` for the app layout set by T003 and the workflow steps added by T005–T007. Read `docs/REQUIREMENT_SOURCE.md` § Repo to ladder engine (L0–L4 table), § LLM strategy (verification pipeline), § LLM architecture (parallel generators), § Generation pipeline, § Grill #9, `experiments/core-spike/RESULTS.md` (all, esp. § 1 and § Known limits), and `experiments/core-spike/src/keycheck.ts`.

---

## Requirement (Pillar 1 — Adapt the requirement)

§ Repo to ladder engine: "Generate the repo-specific top: L1 to L4 below, tied to this repo." and the L0–L4
table (L0 Concept ladder tests; L1 Screenshot or log + 3-sentence explanation; L2 Branch or diff link +
questions generated from your diff; L3 Verified MCQs on core files; L4 Repo link or PR link). "Reuse or draft
concept ladders: … missing ones are AI-drafted and marked unverified." § LLM strategy, verification pipeline:
"Generate only from retrieved chunks (README, docs, source files, learner diff)." "Code check: the answer key
must appear in, or be checkable against, the cited chunk. A citation alone is not proof" "Remove
near-duplicates by embedding similarity." § LLM architecture: "Parallel generators are safe here because each
level is independent and grounded in its own chunks". § Generation pipeline: "Level generators x N (parallel,
grounded chunks) → Code checks (gate: citation, dedupe; key mismatch: regenerate, max 2) → … Save ladder
(status: unverified)". § Grill #9: "Link out; cards are original text only". T001 result: the lexical check
alone false-rejects 11.3% (paraphrase keys); a second check (T009) is required.

**Restated intent** (Supervisor's interpretation):
> Turn the repo + SHA's snapshot, core files and concepts into a saved ladder L0–L4: chunk and embed the
> grounding sources, run one model A generator per level in parallel (each an Inngest step), keep only
> questions whose key passes the answer-key code check against the cited chunk (regenerate max 2, then drop),
> drop near-duplicates by embedding similarity, and save the ladder with status `unverified`.

**Out of scope** (what this task explicitly does NOT do):
- Blind solving by model B (T009 inserts its step between dedupe and save).
- Diff questions (T014) and the pass-test verifiers (T012, T013).
- Shared concept ladders reused across repos (T022): L0 is drafted per ladder here.
- Learner flags (T016); the ladder view (T010).

**Requirement Refs**:
- FR-003: draft a missing concept ladder marked `unverified` (L0 here)
- FR-004: repo-specific levels L1–L4 with their pass tests
- FR-005: low confidence → concept-only ladder
- FR-006: grounded chunks only; answer key checked against the cited chunk; near-duplicate removal by embedding similarity (blind solve: T009; learner flag: T016)
- FR-016: MCQs drawn from a randomized pool (this task produces the pool)
- NFR-005: each step durable and retried on its own
- NFR-006: cards are original text only
- US-001, US-003

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [ ] Restated intent confirmed to match the user's request (by Supervisor / user — not the implementing agent)
- [ ] Domain terms align with `PROJECT_SPEC.md` glossary (`grill-with-docs` run if terminology was fuzzy)
- [ ] Every Acceptance Criterion below traces to a line in the Requirement
- [ ] All Requirement Refs exist in `PRD.md` and are fully covered by the Acceptance Criteria above

> An agent must NOT start implementing until this gate is checked. If anything here is unclear,
> STOP and ask the Supervisor (Karpathy: Think Before Coding).

---

## Dependencies & Reachability

**Depends on**: T007 — step `map-concepts` and stored `repo_concepts` (L0 input), which itself follows T006's `core_files` (L3 input) and T005's snapshot
**Entry point**: Inngest steps `chunk-and-embed`, `generate-level-L0` … `generate-level-L4`, `check-and-dedupe`, `save-ladder` in function `ladder-generate`; function `saveLadder`

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | Step `chunk-and-embed` splits README, `docs/**/*.md`, dependency files and T006 core files at the pinned SHA into chunks (~1,500 chars, 200 overlap, each with `path`, `startLine`, `endLine`, `sha`), embeds them with the embedding model chosen in the brainstorm (AI SDK `embedMany`), and stores them in a pgvector column. Re-running the step for the same repo + SHA writes no duplicate chunk. | Generate only from retrieved chunks; Postgres + pgvector |
| 2 | Five generator steps run in parallel (`Promise.all` of Inngest steps), one per level, each with model A and a zod schema: `{ goal, passTest: { kind, description }, cards: [{ front, back, chunkId }], mcqs: [{ question, options (4), key, chunkId }] }`. `passTest.kind` is fixed per level in code: L0 `concept-mcq`, L1 `run-log-and-explanation`, L2 `branch-diff-and-diff-questions`, L3 `verified-mcq`, L4 `repo-or-merged-pr`. L0 and L3 produce MCQ pools (target 15, keep ≥ 8); every level produces 5–10 review cards. | L0–L4 table; parallel generators |
| 3 | Every MCQ and card cites a `chunkId` that exists for this repo + SHA and was given to that level's generator; any other citation → item dropped with reason `bad-citation`. | A citation alone is not proof; grounded |
| 4 | Answer-key code check (port of T001 `checkAnswerKey`): key ∈ options AND normalised key occurs in the cited chunk at token boundaries. Fail → that question is regenerated with the failure reason, at most 2 times, then dropped with reason `key-check-failed`. The prompt asks for keys that are literal spans of the chunk (T001: paraphrase keys are false-rejected). | Code checks: key mismatch → regenerate, max 2 |
| 5 | Near-duplicate removal: within one ladder, an item whose question/front embedding has cosine similarity ≥ `DEDUPE_COSINE` (default 0.92) with an earlier kept item is dropped with reason `duplicate`. | Remove near-duplicates by embedding similarity |
| 6 | Original text (NFR-006): a card or question whose text shares a run of ≥ 25 consecutive words with any chunk is dropped with reason `verbatim-copy`. The answer key itself is exempt. | cards are original text only |
| 7 | Step `save-ladder` writes the `ladders` row (unique repo + SHA) with status `unverified`, its 5 levels, cards, MCQ pools, and a `generation_report` (counts generated / kept / dropped per reason per level, cost per step). Job status → `done` with `ladderId`; a second `/start` for that repo + SHA is now a cache hit (T005 AC 2). | Save ladder (status: unverified); cached by SHA |
| 8 | Boundary: `fallbackToConcepts: true` → only L0 is generated (concept-only ladder), L1–L4 rows are saved with `kind: "concept-only-skipped"`; a level whose MCQ pool ends below 8 is saved with flag `insufficient-pool` (never silently empty); one generator step failing after its retries fails the job with reason `generate-level-Ln-failed` and saves no ladder. | fall back to concept-only ladders; no partial ladder |

---

## Evaluation & Acceptance (How we know the agent worked correctly)

### Pre-registered thresholds (Supervisor oracle — fixed before the first run; do not tune after)

| Metric on the 20 golden repos | Keep current approach if | Otherwise |
|---|---|---|
| Ladders with L3 pool ≥ 8 MCQs (non-fallback repos) | ≥ 80% of non-fallback repos | Record it; Supervisor decides (larger target pool, different chunking, or entailment check) |
| MCQs dropped by `key-check-failed` after 2 regenerations | ≤ 25% of generated MCQs | Record it as input for T009's measurement |
| Mean cost per ladder | reported only (T017 sets the cap) | — |

Tests assert code correctness, not these thresholds. A miss is a valid result recorded in `tasks/TASK_REVIEW_T008.md`.

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | Fixture repo `developit/mitt` snapshot + core files, mock embedder | chunks stored with line ranges; second run adds 0 rows | vitest (test DB with pgvector) |
| 2 | Mock model returns an L3 MCQ with key `bitmap`, chunk text `uses a map` | regenerated twice, then dropped `key-check-failed`; 3 model calls for that item | vitest |
| 3 | Mock MCQ citing a chunk of another level | dropped `bad-citation` | vitest |
| 4 | Two cards with mock embeddings at cosine 0.95 | second dropped `duplicate` | vitest |
| 5 | Card that copies 30 words of a chunk | dropped `verbatim-copy` | vitest |
| 6 | Inngest test run, `generate-level-L2` throws once | only that step retried; ladder saved `unverified`; job `done` | vitest + Inngest test helper |
| 7 | Snapshot with `fallbackToConcepts: true` | only L0 generated; L1–L4 `concept-only-skipped` | vitest |
| 8 | 20 golden repos, live model A + embedder | `generation_report` per repo + summary with the 3 threshold verdicts | command run (paid) |

### Verification Command (exact, runnable)

```bash
# ci: skip — the golden-set run calls model A and the embedding model (paid, needs API keys); CI runs the unit tests only
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm typecheck && pnpm lint
pnpm test -- chunk-and-embed level-generator answer-key-check dedupe save-ladder
pnpm eval -- --step ladder --subject level-generators
```

### Evidence (filled by reviewer at Stage 4/5)

> **Moved.** Filled by the reviewer at Stage 4/5 in `tasks/TASK_REVIEW_T008.md`.

---

## Demonstration

> **Moved.** See `tasks/TASK_REVIEW_T008.md`.

---

## Approach

**Pattern reference**: `experiments/core-spike/src/keycheck.ts` — `normalise` + token-boundary match (port into the app, keep its tests' cases, do not import from `experiments/`); `experiments/core-spike/src/measure.ts` — MCQ shape (`question`, `options`, `key`, `chunk`, `source`); T006/T007 modules for AI SDK structured output, `logStepCost`, and Inngest step wiring.

**Vital slice**: the L3 generator (verified MCQs on core files) with citation check, answer-key check + regenerate-max-2, and save `unverified`.
**Cut list**:
- reuse of existing concept ladders (T022); L0 is drafted per ladder
- cross-ladder dedupe (within one ladder only)
- difficulty calibration of MCQs
- open-answer prompts (feedback-only grading is a later concern)
- incremental regeneration on a new SHA (a new SHA is a new ladder)

Decompose (C3) into subtasks, each with its own tests, landing in this order: (8a) `chunk-and-embed` + migration; (8b) generator per level with schema and citation check; (8c) answer-key check + regeneration loop, verbatim check, dedupe; (8d) `save-ladder`, job `done`, golden-set subject.

The mandatory brainstorm must settle, and record in `docs/decisions/0002-generation.md` for the Supervisor: (1) the embedding model and its provider (constraints: callable through the AI SDK `embedMany`; fixed vector dimension written into the migration; cost logged via `logStepCost`). If its API key is not in env, stop with `Status: blocked` + `Question:` naming the key. (2) chunk size and overlap. (3) whether the regeneration prompt includes the failure reason. Model A comes from env `MODEL_A_ID`. Each generator gets only its level's chunks: L0 → README + dependency files + concept list; L1 → README + setup docs; L2 → tree summary + issues + core files; L3 → core-file chunks; L4 → core files + `good first issue` titles. Migration through `Skill({ skill: "migration-safety" })`; Common-Infrastructure applies it.

---

## Edge Case Checklist

- [ ] Key appears in the chunk but in a negated sentence ("there is no retry") → passes the lexical check (T001 known limit); left for T009's blind solver, noted in the report
- [ ] A distractor also appears in the chunk → passes the lexical check (T001 known limit); left for T009
- [ ] Key wrapped in markdown (`_last_`, backticks) → T001 rejected these; strip inline markdown from chunks before the check and add a test
- [ ] Options contain duplicates after normalisation → item dropped `bad-options`
- [ ] Chunk boundary cuts the key in half → key not found → regenerate; the 200-char overlap reduces this
- [ ] Repo with no `docs/` and a short README → L1 still has a goal and pass test; cards may be < 5 → flag `insufficient-cards`
- [ ] Generator step retried by Inngest → no duplicate cards (write only in `save-ladder`, keyed by step output)
- [ ] Repo text with prompt injection → schema unchanged, output still grounded (repo text is data)

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| app server modules (layout set by T003): chunker, embedder wrapper, level generators, answer-key check port, verbatim check, dedupe, `saveLadder` | logic |
| `ladder-generate` Inngest function | add steps `chunk-and-embed`, `generate-level-L0`–`L4`, `check-and-dedupe`, `save-ladder` |
| new migration | `chunks` (pgvector), `levels`, `cards`, `mcqs`, `generation_reports`; `ladders.status` values |
| `eval/src/subjects/level-generators.ts` | golden-set subject |
| `.env.example` | embedding provider key name and model id, `DEDUPE_COSINE` |
| `docs/decisions/0002-generation.md` | brainstorm decision |
| tests + fixtures | AC 1–8 |
| `tasks/TASK_REVIEW_T008.md` | Evidence (reviewer) |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `.claude/**`, `agents/**`, `skills/**`, `templates/**`, `AGENTS.md`, `CLAUDE.md` | kit |
| `PRD.md`, `PROJECT_SPEC.md`, `PROJECT_KANBAN.md`, `BRAINSTORMING_LOG.md`, `memory/**` | Supervisor-owned |
| `experiments/**` | throwaway spikes; port code, do not import or edit |
| `eval/golden/**`, `eval/src/score*` | T004's oracle |
| T005–T007 step logic and routes | owned by those tasks; only append steps |

---

## Test Plan

vitest per subtask with the AI SDK mock language model and a deterministic mock embedder (fixed vectors) for AC 1–6 and 8; Inngest test helper for parallel steps and single-step retry (AC 7, Success 6); integration tests on a pgvector test DB. Real run: golden-set eval on 20 repos and one live `/start?url=https://github.com/developit/mitt` to `done` with a saved `unverified` ladder; paste the `generation_report` and threshold verdicts. Adversarial verify (C3): try a fixture with injected instructions and a fixture with keys only in negated sentences.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run
- [ ] Security review: `Skill({ skill: "security-review" })` run (Medium risk)
- [ ] Migration safety: `Skill({ skill: "migration-safety" })` run (new tables, pgvector column)
- [ ] Lint passes (`pnpm lint`, `pnpm typecheck`)
- [ ] Tests written AND pass — output pasted into `tasks/TASK_REVIEW_T008.md` Evidence (Hard-Stop Gate 5)
- [ ] `Skill({ skill: "verify" })` run — headless auto verify (adversarial at C3)
- [ ] Supervisor notified: task ready for Stage 4 review
