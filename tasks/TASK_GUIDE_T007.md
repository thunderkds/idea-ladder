# TASK_GUIDE — T007: Concept mapper (3–6 concepts, structured output) + learner edits concepts
**Date**: 2026-11-01
**Complexity Level**: C2
**Risk Level**: Low
**Priority**: P1
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
6. C2: read `memory/codebase-map.md` for the app layout set by T003 and the workflow steps added by T005/T006. Read `docs/REQUIREMENT_SOURCE.md` § Repo to ladder engine, § LLM strategy (Map repo to concepts row), `docs/MAIN_FLOW.md` § 2, and `eval/` (T004: `scoreConcepts`, `logStepCost`).

---

## Requirement (Pillar 1 — Adapt the requirement)

§ Repo to ladder engine: "Concepts are the reusable unit; the repo is only the entry point." "Detect concepts:
AI maps the repo to 3 to 6 concepts (e.g. "Rust async", "embeddings", "CRDT")." "Score confidence: thin README
or no issues means low confidence; fall back to concept-only ladders." § LLM strategy: "Map repo to concepts —
Yes — Low stakes; learner can edit — Wrong mapping is cheap to fix". § Generation pipeline: "Concept mapper (1
LLM call, structured)". § Sequence: ladder generation: "10 Workflow→LLMs map concepts (model A, schema)".

**Restated intent** (Supervisor's interpretation):
> Add Inngest step `map-concepts`: one structured model A call that maps the repo (snapshot + core files from
> T006) to 3–6 concepts, each with a reason and the files or snapshot fields it rests on. The learner can then
> rename, remove or add concepts for themself on a small edit screen, without changing the shared cached
> mapping other learners see.

**Out of scope** (what this task explicitly does NOT do):
- Concept ladders (reuse or draft: FR-003, T008 L0 draft and T022 shared ladders).
- Regenerating levels after a learner edit (cut: edits are stored and shown; later tasks may read them).
- Concept ontology or synonyms across repos (T022).

**Requirement Refs**:
- FR-002: map a repo to 3–6 concepts; the learner can edit the mapping
- FR-005: low confidence → fall back to concept-only ladders (the mapper output carries the fallback flag from T005)
- US-001: paste a repo URL and get a ladder

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [ ] Restated intent confirmed to match the user's request (by Supervisor / user — not the implementing agent)
- [ ] Domain terms align with `PROJECT_SPEC.md` glossary (`grill-with-docs` run if terminology was fuzzy)
- [ ] Every Acceptance Criterion below traces to a line in the Requirement
- [ ] All Requirement Refs exist in `PRD.md` and are fully covered by the Acceptance Criteria above

> An agent must NOT start implementing until this gate is checked. If anything here is unclear,
> STOP and ask the Supervisor (Karpathy: Think Before Coding).

---

## Dependencies & Reachability

**Depends on**: T006 — step `pick-core-files` and the stored `core_files` for the repo + SHA (input of the mapper)
**Entry point**: `mapConcepts` (called by Inngest step `map-concepts`); learner screen `/ladders/:ladderId/concepts` with button label `Save concepts`

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | `mapConcepts({ snapshot, coreFiles, confidence })` makes exactly 1 model A call with an AI SDK structured-output schema (zod): `{ concepts: [{ name (2–60 chars), slug, reason (≤ 300 chars), basis: string[] }] }` with 3–6 items. `slug` is derived in code (lower-case, `-`-joined), not trusted from the model. | 3 to 6 concepts; 1 LLM call, structured |
| 2 | Every `basis` entry is a core-file path from T006 or one of `readme`, `topics`, `languages`, `depFiles`; any other value is dropped. A concept left with an empty `basis` is dropped; fewer than 3 concepts left → one retry, then step fails `mapper-invalid-output`. | grounded mapping |
| 3 | Inngest step `map-concepts` runs after `pick-core-files`, stores `repo_concepts` for the repo + SHA, carries `fallbackToConcepts` from the T005 confidence result, logs cost via `logStepCost` with `step: "map-concepts"`, and on retry re-runs only itself. | fall back to concept-only ladders; durable steps |
| 4 | Learner edit: `PUT /api/ladders/:ladderId/concepts` (signed in) stores a per-learner list in `learner_concepts`. The shared `repo_concepts` rows are unchanged. `GET` returns the learner's list if one exists, else the shared list. | learner can edit; cache shared by repo + SHA |
| 5 | Negative / boundary: saving 2 or 7 concepts, an empty or > 60-char name, or duplicate slugs → `422` with the field named; the screen shows the error next to the field and keeps the learner's input. | 3 to 6 concepts |
| 6 | The screen `/ladders/:ladderId/concepts` lists the concepts with their reason, lets the learner rename, remove and add (keyboard reachable, labelled inputs), and `Save concepts` persists; reload shows the saved list. A banner reads `Low confidence: this ladder uses concepts only` when `fallbackToConcepts` is true. | learner can edit; fall back flag visible |
| 7 | Golden set: `pnpm eval -- --step concepts --subject concept-mapper` reports mean concept overlap vs T004 labels and mean cost per call for all 20 repos (reported, no threshold: wrong mapping is cheap to fix). | Compare concept maps on the golden set |

---

## Evaluation & Acceptance (How we know the agent worked correctly)

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | Mock model returns 4 concepts, one with `basis: ["src/nope.ts"]` only | 3 concepts stored; the invented basis dropped | vitest |
| 2 | Mock model returns 2 valid concepts twice | step fails `mapper-invalid-output` after 1 retry | vitest |
| 3 | Learner A saves `["Event emitter","Pub/sub","TypeScript generics"]` | learner A sees it; learner B and `repo_concepts` unchanged | vitest (integration, test DB) |
| 4 | `PUT` with 7 concepts / duplicate slug | `422` naming the field | vitest |
| 5 | Playwright: rename one concept, remove one, add one, `Save concepts`, reload | saved list shown | automated e2e |
| 6 | Snapshot with `fallbackToConcepts: true` | banner text visible | automated e2e |
| 7 | 20 golden repos, model A | report with mean overlap and cost | command run (paid) |

### Verification Command (exact, runnable)

```bash
# ci: skip — the golden-set run calls model A (paid, needs ANTHROPIC_API_KEY); CI runs the unit and e2e tests only
pnpm install --frozen-lockfile
pnpm typecheck && pnpm lint
pnpm test -- concept-mapper learner-concepts
pnpm test:e2e -- concepts-edit
pnpm eval -- --step concepts --subject concept-mapper
```

### Evidence (filled by reviewer at Stage 4/5)

> **Moved.** Filled by the reviewer at Stage 4/5 in `tasks/TASK_REVIEW_T007.md`.

---

## Demonstration

> **Moved.** See `tasks/TASK_REVIEW_T007.md`.

---

## UI / Design Acceptance Criteria

> Screen: `/ladders/:ladderId/concepts`. Check against the tokens file created in T003.

### 1. Visual Regression

| Screen / Component | Verification method | Expected result |
|-------------------|---------------------|-----------------|
| Concept edit screen, 4 concepts | Playwright screenshot + LLM-vision verdict against AC 6 | each concept shows name input, reason text, remove control; `Add concept` and `Save concepts` visible |
| Concept edit screen, validation error (7 concepts) | Playwright screenshot + LLM-vision verdict against AC 5 | error message next to the list, input kept |
| Low-confidence banner | Playwright screenshot + LLM-vision verdict | banner text `Low confidence: this ladder uses concepts only` above the list |

### 2. Design-System Compliance

| Criterion | Verification method | Expected result |
|-----------|---------------------|-----------------|
| Colors match design tokens | Playwright computed-style check of inputs, buttons, error text, banner | values from the T003 tokens file; no new hex literal in this task's components |
| Typography matches spec | computed `font-family`, `font-size`, `font-weight` of labels, inputs, reason text | T003 type scale |
| Spacing / layout matches spec | computed `gap` / `padding` between concept rows | T003 spacing scale |

### 3. Layout / Responsiveness

| Viewport | Verification method | Expected result |
|----------|---------------------|-----------------|
| Mobile (360px) | Playwright screenshot at 360×740 + LLM-vision verdict; `scrollWidth <= 360` | one concept per row, inputs full-width, tap targets ≥ 44px |
| Tablet (768px) | Playwright screenshot at 768×1024 + LLM-vision verdict | same single column, wider inputs |
| Desktop (1280px) | Playwright screenshot at 1280×800 + LLM-vision verdict | readable max-width column, buttons aligned right or below |

---

## Approach

**Pattern reference**: T006's reader module (structured output + zod validation + `logStepCost` call) and its Inngest step wiring; T003's `/ladders` page for page and session conventions.

**Vital slice**: the one structured mapper call with grounded `basis`, plus the per-learner save.
**Cut list**:
- regenerating levels on edit
- drag-to-reorder concepts
- concept autocomplete / shared vocabulary (T022)
- undo history of edits

1. Input to the prompt: README (first 6,000 chars), topics, languages, dependency names, and the T006 core-file paths + reasons. Repo text is data, not instructions.
2. Model A via the AI SDK with `MODEL_A_ID`; temperature low; one call, one retry on schema failure.
3. Migration (`Skill({ skill: "migration-safety" })`): `repo_concepts` keyed by repo + SHA; `learner_concepts` keyed by `(user_id, ladder_id)`.
4. Server validation is the source of truth; the screen mirrors the same rules (3–6, 2–60 chars, unique slug).

---

## Edge Case Checklist

- [ ] Model returns the same concept twice with different case (`Embeddings`, `embeddings`) → one concept
- [ ] Non-ASCII names (`Rust async/await`, `日本語`) → slug derivation stable, never empty (fallback slug from a hash)
- [ ] Concept name contains HTML → escaped on the screen
- [ ] Unknown `ladderId`, or a ladder whose `repo_concepts` are missing → 404 page / message, no empty form (until T008 saves ladders, tests seed a `ladders` row)
- [ ] Learner edits, then a new SHA of the repo makes a new ladder → old edits stay with the old ladder id
- [ ] Two tabs save at once → last write wins, both responses valid (documented)

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| app server module for the concept mapper (layout set by T003) | `mapConcepts`, schema, slug |
| `ladder-generate` Inngest function | add step `map-concepts` |
| routes `GET`/`PUT /api/ladders/:ladderId/concepts`, page `/ladders/:ladderId/concepts` | learner edit |
| new migration | `repo_concepts`, `learner_concepts` |
| `eval/src/subjects/concept-mapper.ts` | golden-set subject |
| tests (vitest + Playwright) | AC 1–7 |
| `tasks/TASK_REVIEW_T007.md` | Evidence (reviewer) |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `.claude/**`, `agents/**`, `skills/**`, `templates/**`, `AGENTS.md`, `CLAUDE.md` | kit |
| `PRD.md`, `PROJECT_SPEC.md`, `PROJECT_KANBAN.md`, `BRAINSTORMING_LOG.md`, `memory/**` | Supervisor-owned |
| `experiments/**` | throwaway spikes |
| `eval/golden/**`, `eval/src/score*` | T004's oracle |
| T005/T006 step logic (`fetch-repo`, `pick-core-files`) | owned by those tasks; only append a step |

---

## Test Plan

vitest with the AI SDK mock model for schema, basis filtering, retry and slug rules; integration tests on a test DB for per-learner edits; Playwright e2e for the edit screen and the UI section screenshots at 360/768/1280 px. Real run: golden-set eval (AC 7) and one live `/start` on `developit/mitt` showing concepts on the edit screen.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run
- [ ] Migration safety: `Skill({ skill: "migration-safety" })` run (new tables)
- [ ] Lint passes (`pnpm lint`, `pnpm typecheck`)
- [ ] Tests written AND pass — output pasted into `tasks/TASK_REVIEW_T007.md` Evidence (Hard-Stop Gate 5)
- [ ] `Skill({ skill: "verify" })` run — headless auto verify
- [ ] Supervisor notified: task ready for Stage 4 review
