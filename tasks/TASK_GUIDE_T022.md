# TASK_GUIDE — T022: Concept ladders shared across repos (reuse by concept)
**Date**: 2026-11-01
**Complexity Level**: C2
**Risk Level**: Medium
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
6. C2: read `memory/codebase-map.md` (the app layout set by T003, once mapped). Read `tasks/TASK_GUIDE_T007.md` (concept mapper output), `tasks/TASK_GUIDE_T008.md` (level generators, embedding dedupe, save ladder `unverified`), `tasks/TASK_GUIDE_T004.md` (golden set), and `docs/REQUIREMENT_SOURCE.md` § Repo to ladder engine.

---

## Requirement (Pillar 1 — Adapt the requirement)

Requirement § Repo to ladder engine: "Concepts are the reusable unit; the repo is only the entry point. Ten
trending repos may all be "vector database" or "local LLM agent". Ladder per repo means thousands of duplicates;
ladder per concept scales and lets the community improve one shared ladder."; "Reuse or draft concept ladders:
existing community ladders are reused; missing ones are AI-drafted and marked unverified."; level table: "L0
Prerequisites — Concepts you're missing — Concept ladder tests — Dependencies, languages, topics". § Grill #8:
"Cache by repo + SHA; concept ladders reused across repos". § Brainstorm: "Concept ladders shared across repos —
Dedupes content; community improves one ladder — v1".

**Restated intent** (Supervisor's interpretation):
> When a new repo maps to a concept that already has a concept ladder, the pipeline reuses that ladder for L0
> instead of generating a new one; only concepts with no match are drafted and saved `unverified`. A learner who
> already passed a concept ladder's test sees it passed in every repo ladder that shares the concept.

**Out of scope** (what this task explicitly does NOT do):
- Community-authored ladders and their repo (T025, T026); author credit (T027).
- Merging two existing concept ladders that turn out to be duplicates (manual, later).
- Changing how L1–L4 are generated (T008).
- Any UI beyond the existing ladder view (T010) showing the reused L0.

**Requirement Refs**:
- FR-003: reuse an existing concept ladder or draft a missing one marked `unverified`
- FR-002: the 3–6 concepts from the mapper are the lookup keys
- NFR-004: later learners reuse instead of paying generation again
- US-001: a pasted repo gets a ladder L0–L4

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [ ] Restated intent confirmed to match the user's request (by Supervisor / user — not the implementing agent)
- [ ] Domain terms align with `PROJECT_SPEC.md` glossary (`grill-with-docs` run if terminology was fuzzy)
- [ ] Every Acceptance Criterion below traces to a line in the Requirement
- [ ] All Requirement Refs exist in `PRD.md` and are fully covered by the Acceptance Criteria above

> An agent must NOT start implementing until this gate is checked. If anything here is unclear,
> STOP and ask the Supervisor (Karpathy: Think Before Coding).

---

## Dependencies & Reachability

**Depends on**: T008 — the generation pipeline that turns mapped concepts into levels and saves the ladder `unverified` (this task inserts the reuse lookup before L0 generation); T008 also provides the embedding function used for dedupe
**Entry point**: `findConceptLadder` (called from the Inngest generation function's concept step)

> v2 task: planned only. Pickup waits for Gate 2 ("Others finish L1 without your help").

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | `findConceptLadder(concept)` matches first by normalised slug (NFKC, lower-case, spaces/punctuation → `-`), then by pgvector cosine similarity of the concept-name embedding ≥ `CONCEPT_MATCH_MIN` (constant fixed in the test oracle below, not tuned per call). It returns `{ ladderId, matchedBy: "slug" | "embedding", similarity }` or `null`. | "existing ... ladders are reused" |
| 2 | Generating a second repo that maps to an already-stored concept makes 0 model calls for that concept's L0 and links the repo ladder to the existing concept ladder (checked by a mocked model counter). | "Ladder per concept scales"; NFR-004 |
| 3 | A concept with no match is drafted once, saved with status `unverified`, and becomes findable by the next lookup. | "missing ones are AI-drafted and marked unverified" |
| 4 | Two generations that draft the same new concept at the same time end with exactly one concept ladder (unique slug constraint + upsert); both repo ladders link to it. | dedupe; one shared ladder |
| 5 | On the labelled fixture `concept-pairs.json` (≥ 40 pairs from the golden set's mapped concepts, hand-labelled same / different by the Supervisor before the run), the matcher has 0 false merges and reports its recall. A false merge fails the test; low recall does not. | "Ten trending repos may all be ..." without merging different concepts |
| 6 | A learner with a passing evidence record for a concept ladder's test sees L0 for that concept as passed in another repo ladder that links the same concept ladder version; a newer version of the concept ladder does not inherit the pass. | "Concept ladder tests" as L0 pass test |
| 7 | Existing repo ladders saved before this task keep working: the migration backfills their L0 into concept ladders without changing any evidence record. | migration safety; append-only evidence |

---

## Evaluation & Acceptance (How we know the agent worked correctly)

### Pre-registered threshold (Supervisor oracle — fixed before the first run; do not tune after)

`CONCEPT_MATCH_MIN` = the lowest similarity at which the labelled fixture shows 0 false merges, chosen once on a
first half of the fixture and checked on the second half. If the second half shows any false merge, record
"embedding match unsafe; slug-only match" in `tasks/TASK_REVIEW_T022.md` and ship slug-only matching.

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | Stored concept `embeddings`; new concept `Embeddings` | slug match, same `ladderId` | vitest |
| 2 | Stored `vector database`; new `vector DB` | embedding match if similarity ≥ `CONCEPT_MATCH_MIN`, else `null` | vitest (fixed embeddings fixture) |
| 3 | Stored `Rust async`; new `Rust ownership` | `null` (no false merge) | vitest |
| 4 | Second repo sharing 2 of 3 concepts | 2 reused, 1 drafted `unverified`; model counter shows L0 calls for 1 concept only | vitest (mocked model) |
| 5 | Two parallel drafts of the same new concept | 1 concept ladder row | vitest (test DB) |
| 6 | Second half of `concept-pairs.json` | 0 false merges; recall printed | `pnpm eval:concepts` |

### Verification Command (exact, runnable)

```bash
pnpm install --frozen-lockfile && pnpm db:migrate && pnpm test -- concept-ladder && pnpm eval:concepts && pnpm lint
```

### Evidence (filled by reviewer at Stage 4/5)

> **Moved.** Filled by the reviewer at Stage 4/5 in `tasks/TASK_REVIEW_T022.md`.

---

## Demonstration

> **Moved.** See `tasks/TASK_REVIEW_T022.md`.

---

## Approach

**Pattern reference**: T008's embedding dedupe (pgvector cosine query) for the similarity lookup; `experiments/core-spike/src/keycheck.ts` `normalise` for slug normalisation.

**Vital slice**: slug + embedding lookup in the concept step, and the draft-once path.
**Cut list**:
- concept ladder merge tool for duplicates found later
- concept synonyms table edited by hand
- cross-version pass carry-over (a new version needs a new pass)
- recall tuning (only false merges block)

Data: `concept_ladders` (id, slug unique, title, name_embedding vector, status `unverified|verified`, version) and
`ladder_concepts` (repo ladder id, concept ladder id, version). The concept step runs after T007's mapper and
before L1–L4 generation; it is its own Inngest step so a retry does not re-draft. Embed the concept name only
(short text, cheap); the same embedding model as T008's dedupe. A false merge is worse than a duplicate, so the
threshold favours precision. Run `Skill({ skill: "migration-safety" })` for the new tables and the backfill
(reversible: the backfill only inserts).

---

## Edge Case Checklist

- [ ] Concept names that differ only by case, spaces or punctuation (`CRDT`, `crdts`, `C.R.D.T.`) — decide plural handling explicitly in the slug rule and test it
- [ ] Learner edited the concept name (T007) — the lookup uses the edited name
- [ ] Mapper returns the same concept twice for one repo — one link
- [ ] A matched concept ladder is retired later (T026) — repo ladder keeps its linked version
- [ ] Embedding service fails — fall back to slug-only match and draft, never block the ladder
- [ ] Concept in a non-English name — NFKC slug; embedding still compared
- [ ] Backfill on an empty DB — no-op, migration still reversible

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| generation pipeline module from T008 (app layout set by T003, see `memory/codebase-map.md` once mapped) | concept step: lookup, reuse, draft-once |
| new concept ladder module | `findConceptLadder`, slug rule, upsert |
| new migration in T003's migrations folder | `concept_ladders`, `ladder_concepts`, backfill |
| evals folder from T004 | `concept-pairs.json` fixture (labels from the Supervisor), `pnpm eval:concepts` script |
| tests for the concept ladder module | AC 1–7 |
| `tasks/TASK_REVIEW_T022.md` | Evidence (reviewer) |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `.claude/**`, `agents/**`, `skills/**`, `templates/**`, `AGENTS.md`, `CLAUDE.md` | kit |
| `PRD.md`, `PROJECT_SPEC.md`, `PROJECT_KANBAN.md` | Supervisor-owned |
| `experiments/**` | throwaway spikes |
| evidence record table and writer (T012) | append-only; read only |
| golden set repos and their labels (T004) | shared oracle; add a fixture, never change existing labels |

---

## Test Plan

vitest unit tests for the slug rule and the matcher on fixed embeddings (Success 1–3). Integration tests on the
test Postgres + pgvector for reuse, draft-once and concurrency with a mocked model counter (Success 4–5). Eval run
`pnpm eval:concepts` on the labelled pairs (Success 6). Real run: generate two golden-set repos that share a
concept and paste the DB rows showing one shared concept ladder.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run
- [ ] Security review: `Skill({ skill: "security-review" })` run (Medium risk)
- [ ] `Skill({ skill: "migration-safety" })` run (new tables + backfill)
- [ ] Lint passes (`pnpm lint`, `tsc --noEmit`)
- [ ] Tests written AND pass — output pasted into `tasks/TASK_REVIEW_T022.md` Evidence (Hard-Stop Gate 5)
- [ ] `Skill({ skill: "verify" })` run — headless auto verify
- [ ] Supervisor notified: task ready for Stage 4 review
