# TASK_GUIDE — T031: Remove embeddings: drop the embedder, `chunks.embedding` and `@ai-sdk/openai`; dedupe by word overlap
**Date**: 2026-11-19
**Complexity Level**: C2
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
5. Note the **Complexity Level** above and apply the matching process from the Complexity matrix in `agents/backend.md` (C2)
6. Read `memory/decisions.md` entries "2026-11-19 — T008 merged" and "2026-11-19 — Claude subscription only", and `docs/decisions/0006-generation.md`.

---

## Requirement (Pillar 1 — Adapt the requirement)

User decision 2026-11-19 (`memory/decisions.md` "Claude subscription only: no second provider, no embeddings"):
"There is no embedding model: near-duplicate removal uses word-overlap similarity, and chunks are stored without
vectors. No `OPENAI_API_KEY` is needed." "Follow-up: new task T031 removes the embedder, the `chunks.embedding`
column and `@ai-sdk/openai` from merged T008 code (storage format change: extended track)". PRD FR-006 as
rewritten by the same decision: near-duplicate removal by word-overlap similarity.

**Restated intent** (Supervisor's interpretation):
> Ladder generation must run end to end with no OpenAI key and no embedding call: chunks are still split and
> stored (they are the citation targets), but without a vector; near-duplicate MCQs and cards are removed by a
> deterministic word-overlap similarity; the OpenAI provider package, its config keys and its price/startup
> checks are gone. Everything else T008 delivered (generators, key check, verbatim check, save-ladder) behaves
> exactly as before.

**Out of scope** (what this task explicitly does NOT do):
- Model B / blind solve (T009).
- Dropping the `vector` Postgres extension (created in 0001; T022 may use it) — leave it.
- Any change to the level generators, answer-key check, verbatim check or save-ladder logic beyond removing the embedder parameter.
- Rewriting migration 0008 (it is merged; the change is a new migration).

**Requirement Refs**:
- FR-006: grounded chunks; answer key checked against the cited chunk; near-duplicate removal by word-overlap similarity
- NFR-005: each step durable and retried on its own

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [x] Restated intent confirmed to match the user's request (by Supervisor / user — not the implementing agent) — auto (Supervisor) 2026-11-19: matches the user's "just using the claude subscription" decision and its T031 follow-up, and the user's "complete all task [admin]"
- [x] Domain terms align with `PROJECT_SPEC.md` glossary (`grill-with-docs` run if terminology was fuzzy)
- [x] Every Acceptance Criterion below traces to a line in the Requirement
- [x] All Requirement Refs exist in `PRD.md` and are fully covered by the Acceptance Criteria above

> An agent must NOT start implementing until this gate is checked. If anything here is unclear,
> STOP and ask the Supervisor (Karpathy: Think Before Coding).

---

## Dependencies & Reachability

**Depends on**: T008 (merged 0112901)
**Entry point**: Inngest function `ladder-generate`, steps `chunk` (renamed from `chunk-and-embed`) and `check-and-dedupe`; `bun run eval -- --step ladder --subject level-generators`

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | New migration `0010_drop_chunk_embeddings` drops `chunks.embedding` and `chunks.embedding_model`; every existing chunk row (id, path, lines, text) is kept. Its down migration re-adds both columns as nullable (no vector data comes back; the down file says so in a `DESTRUCTIVE`/lossy header). `bun test migrate` covers up, down, up. | chunks are stored without vectors |
| 2 | The step formerly `chunk-and-embed` is renamed `chunk` (constant `CHUNK_STEP`); it splits and stores chunks exactly as before (same chunker, same `(repo, sha, source, path, ordinal)` idempotency), makes no embedding call, and a re-run for the same repo + SHA adds no row. Failure reasons `embedder-error` and `embedder-not-configured` no longer exist anywhere in `src/`. | No embedding model |
| 3 | Step `check-and-dedupe` removes near-duplicates by word-overlap similarity (DEDUPE_RULE below) instead of cosine; drop reason stays `duplicate`; no model or network call. Env `DEDUPE_COSINE` is replaced by DEDUPE_ENV below, validated in `config.ts` the same way (bad value → startup problem). | near-duplicate removal uses word-overlap similarity |
| 4 | `src/server/embedder.ts`, `tests/support/mock-embedder.ts`, `tests/chunk-and-embed.test.ts` (renamed to `tests/chunk.test.ts`) and every `Embedder` import are removed or replaced; `@ai-sdk/openai` is removed from `package.json` and `bun.lock`; `OPENAI_API_KEY` / `EMBEDDING_MODEL_ID` are removed from `config.ts`, `main.ts`, `.env.example`, the eval subject and `e2e/serve.ts`. `grep -rniE "openai|embedd?ing|embedder|cosine" src eval/src e2e tests package.json` finds no live use (comments that record history in `docs/` are fine; `docs/decisions/0006-generation.md` gets a "Superseded 2026-11-19 (T031)" note for its embedding sections). | No OPENAI_API_KEY is needed |
| 5 | The eval subject `level-generators` runs with only `GITHUB_TOKEN` + the Claude login (no `OPENAI_API_KEY` check); with no credentials it still fails fast naming the missing ones and makes no model call. | No OPENAI_API_KEY is needed |
| 6 | Whole suite stays green: `bun test`, `cd eval && bun test`, `bun run typecheck && bun run lint`, `bun run test:e2e -- start-flow`. | Everything else behaves as before |

**DEDUPE_RULE** (Debate, see `## Questions Log`): Jaccard on word sets, `|A∩B| / |A∪B|`, returning 0 when either set is empty. Words come from the tokeniser the verbatim check already uses (`words()` in `src/server/verbatim-check.ts`: `normalise(stripInlineMarkdown(s))` split on `/[^\p{L}\p{N}_]+/u`); export it and reuse it, no stop-word removal, no stemming. Compared text: MCQ `question` and card `front` only, one pool per ladder, same order as today (L0 → L4, MCQs before cards). `keepDistinct(texts, threshold)` keeps its rule: an item is dropped when its score against an EARLIER KEPT item is `>=` the cutoff.
**DEDUPE_ENV**: `DEDUPE_JACCARD`, default `0.8`, range (0, 1], parsed and refused by name like today's `DEDUPE_COSINE`; config field `dedupeJaccard`, constant `DEFAULT_DEDUPE_JACCARD`. A leftover `DEDUPE_COSINE` in env is refused by name at startup ("DEDUPE_COSINE was removed (T031): use DEDUPE_JACCARD"), so an old 0.92 is never read as a Jaccard cutoff.

---

## Evaluation & Acceptance (How we know the agent worked correctly)

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | DB at 0009 with a chunk row holding an embedding | after 0010 up: row kept, columns gone; down then up again succeeds | bun test migrate |
| 2 | Fixture repo `developit/mitt`, no `OPENAI_API_KEY` in env | step `chunk` stores chunks; second run adds 0 rows | bun test chunk |
| 3 | Two MCQs that differ by one word / two MCQs on different facts of one chunk | first pair: second dropped `duplicate`; second pair: both kept | bun test dedupe check-and-dedupe |
| 4 | Inngest test run of `ladder-generate` with mock model A and no embedder | ladder saved `unverified`, job `done` | bun test save-ladder level-generator-step |
| 5 | Grep of AC 4 | no live use | command run |

### Verification Command (exact, runnable)

```bash
bun install --frozen-lockfile
bun run db:migrate
bun run typecheck && bun run lint
bun test migrate chunk dedupe check-and-dedupe save-ladder level-generator config
bun test
grep -rniE "openai|embedd?ing|embedder|cosine" src eval/src e2e tests package.json || echo "no embedding use left"
```

### Evidence (filled by reviewer at Stage 4/5)

> **Moved.** Filled by the reviewer at Stage 4/5 in `tasks/TASK_REVIEW_T031.md`.

---

## Demonstration

> **Moved.** See `tasks/TASK_REVIEW_T031.md`.

---

## Approach

**Pattern reference**: `src/server/verbatim-check.ts` and `src/server/answer-key-check.ts` for the existing text normalisation (reuse it for the word-overlap tokens rather than writing a new normaliser); `migrations/0008_generation.*.sql` and `src/server/migrate.ts` for the migration style (header comments, down guarded by the runner).

**Vital slice**: migration 0010 + step `chunk` without embeddings + word-overlap dedupe, suite green.
**Cut list**:
- dropping the `vector` extension
- cross-ladder dedupe
- a paraphrase-aware dedupe (needs a model; user chose none)

Migration through `Skill({ skill: "migration-safety" })` (drop column = data loss of the stored vectors; accepted by the user decision, unused by any code). Keep one commit per item: migration; step rename + embedder removal; dedupe; config/env/eval/e2e cleanup; docs note.

---

## Edge Case Checklist

- [ ] Old Inngest runs mid-flight with step id `chunk-and-embed` → none in production (no deploy yet, T018); note it in the decision doc
- [ ] An MCQ whose text is all stop-words / very short → similarity defined (no divide by zero), not dropped by accident
- [ ] Question text identical except punctuation / case → dropped `duplicate`
- [ ] A local DB with rows in `chunks` from T008 runs → 0010 keeps them (AC 1)

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| `migrations/0010_drop_chunk_embeddings.up.sql` / `.down.sql` | new |
| `src/server/ladder-generate.ts` | step `chunk`, no embedder dep |
| `src/server/check-and-dedupe.ts`, `src/server/dedupe.ts` | word-overlap dedupe |
| `src/server/embedder.ts` | delete |
| `src/server/config.ts`, `src/server/main.ts`, `.env.example` | drop OpenAI/embedding keys; DEDUPE_ENV |
| `eval/src/level-generators-subject.ts`, `eval/src/subjects/level-generators.ts` | no embedder |
| `e2e/serve.ts` | no mock embedder |
| `package.json`, `bun.lock` | remove `@ai-sdk/openai` |
| `docs/decisions/0006-generation.md` | superseded note |
| tests | AC 1–6 |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `.claude/**`, `agents/**`, `skills/**`, `templates/**`, `AGENTS.md`, `CLAUDE.md` | kit |
| `PRD.md`, `PROJECT_SPEC.md`, `PROJECT_KANBAN.md`, `BRAINSTORMING_LOG.md`, `memory/**`, `tasks/**` | Supervisor-owned |
| `migrations/0001`–`0009` | merged migrations are immutable |
| `experiments/**`, `eval/golden/**`, `eval/src/score*` | spikes / T004 oracle |

---

## Test Plan

bun test: migration up/down/up with a seeded chunk row (AC 1); step `chunk` idempotency with no embedder (AC 2); dedupe unit tests for the rule incl. edge cases (AC 3); Inngest end-to-end with mock model A (SC 4); config tests for DEDUPE_ENV. Real run: `bun run eval -- --step ladder --subject level-generators` with no credentials → fails fast naming `GITHUB_TOKEN` (and the Claude login if checked), not `OPENAI_API_KEY`.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run
- [ ] Security review: `Skill({ skill: "security-review" })` run (Medium risk)
- [ ] Migration safety: `Skill({ skill: "migration-safety" })` run (drop columns)
- [ ] Lint passes (`bun run lint`, `bun run typecheck`)
- [ ] Tests written AND pass — output pasted into `tasks/TASK_REVIEW_T031.md` Evidence (Hard-Stop Gate 5)
- [ ] `Skill({ skill: "verify" })` run — headless auto verify
- [ ] Supervisor notified: task ready for Stage 4 review

---

## Questions Log

- 2026-11-19 DEBATE Which word-overlap measure, cutoff and env var replace cosine dedupe? → Jaccard on raw word sets (shared `words()` tokeniser), question/front only, `DEDUPE_JACCARD` 0.8, leftover `DEDUPE_COSINE` refused (Advocate 1: Jaccard on content words with stop-word removal and plural fold, cutoff 0.7; Advocate 2: Jaccard on raw word sets, cutoff 0.8) ⚠ decided for you — please review
