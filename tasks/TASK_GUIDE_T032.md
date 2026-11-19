# TASK_GUIDE — T032: Generated cards never reach the review queue (one card table: `review_cards`)
**Date**: 2026-11-19
**Complexity Level**: C2
**Risk Level**: Medium
**Priority**: P0
**Assigned agent**: backend-developer
**Agent guide**: `agents/backend.md`

## Bug Fix Task Guide — T032

### Mental Model (confirmed by user)
> Auto mode ([admin]): confirmed by the Supervisor from the code (RULE: docs/claude-md/tracks.md `### Every user stop and its auto rule`), not by the user.
- Observed: `saveLadder` (src/server/save-ladder.ts:94) inserts every kept card into table `cards` (migration 0009). Nothing in `src/` inserts into `review_cards`. The review queue, rating, offline pack and reminders read only `review_cards` (src/server/review.ts:57, :107; src/server/offline.ts:55). On a failed MCQ test, `mcq-test.ts:207` returns `cards` ids as `reviewCardIds`; those ids cannot be rated.
- Expected: after a ladder is saved, its generated cards are rows of `review_cards` (one table, one id space), so they appear in `GET /api/review/queue` for a learner whose level is open, and the `reviewCardIds` of a failed MCQ test are ids `rateCard` accepts.
- Likely divergence point: T008 created its own `cards` table, although docs/decisions/0003-review-tables.md:7 says "T008 writes `review_cards` and adds columns only if it must; T011 only reads it." Tests hid it: review tests seed `review_cards` by hand, generation tests read `cards`.
- Recent context: T008 merged 0112901 (0009); T012 merged 9752304 (reads `cards` for `reviewCardIds`); memory/decisions.md T012 entry lists the gap.

### Intake
- Trigger: generate a ladder (Inngest `ladder-generate` to `save-ladder`), then call `GET /api/review/queue` as a learner with L0 open → no card of that ladder is returned.
- Severity: P1 (blocking: the daily review loop gets no generated content)
- Affected area: src/server/save-ladder.ts, src/server/mcq-test.ts, a new migration, tests that seed or read `cards`.

### Complexity & Risk
- Complexity: C2 (migration + 2 source files + tests)
- Risk: Medium (moves stored rows between tables)

### Fix shape (Debate, see `## Questions Log`)
New migration `0012_review_cards_content`:
- Up: `ALTER TABLE review_cards ADD COLUMN position integer CHECK (position >= 0), ADD COLUMN chunk_id bigint REFERENCES chunks (id)` (both nullable: hand-seeded rows have neither); unique index on `(ladder_id, level, position)` (NULL positions do not collide); copy every `cards` row into `review_cards` (`ORDER BY id`); a `DO` block that raises when the copied count differs from the `cards` count; `DROP TABLE cards`.
- Down: recreate `cards` exactly as in 0009, copy back the `review_cards` rows with `chunk_id IS NOT NULL`, drop the index and the two columns. Never delete `review_cards` rows (`review_log` may reference them; it is append-only, no cascade). Header marks it lossy for ids (renumbered) and throwaway-only like the others.
- Code: `saveLadder` inserts into `review_cards`; `mcq-test.ts` reads `review_cards`. `card_states`, `review_log`, their FKs and the append-only trigger are not touched. Update docs/decisions/0003-review-tables.md with the two new columns.

### Acceptance Criteria
| # | Criterion (testable) |
|---|----------------------|
| 1 | Regression test (written first, red on main): save a ladder through `saveLadder`, open L0 for a learner, `reviewQueue` / `GET /api/review/queue` returns that ladder's L0 cards. |
| 2 | A failed MCQ attempt returns `reviewCardIds` that `rateCard` accepts (200), linked by `chunk_id` as before. |
| 3 | Migration 0012 up on a DB with `cards` rows keeps every card (same front, back, level, position, chunk_id) in `review_cards` and drops `cards`; down then up again succeeds; hand-seeded `review_cards` rows keep their ids; a `review_log` row stays valid. Tested in tests/migrate.test.ts. |
| 4 | `grep -rnE "INTO cards|FROM cards" src tests e2e` finds nothing; full suite green. |

### Diagnosis Gates (Pillar 1 — must pass before any fix)
- [ ] Phase 1 feedback loop built and running
- [ ] Bug reproduces deterministically on the loop
- [ ] 3–5 ranked falsifiable hypotheses listed (consistent with confirmed mental model)
- [ ] Correct hypothesis identified via Phase 4 instrumentation

### Attempts Log (filled live during diagnosis — required if >1 hypothesis tested)
| # | Hypothesis | Predicted signal | Actual result | Verdict |
|---|---|---|---|---|

**Stuck checkpoint** (if 2 consecutive hypotheses disproven):
- [ ] 3 options presented (next hypothesis / widen scope / abandon+escalate)
- [ ] Chosen option: ___
- [ ] User's explicit go-ahead: ___

### Fix Gates (Pillar 2)
- [ ] Regression test written before the fix (or no-seam documented)
- [ ] Fix applied; regression test passes
- [ ] Phase 1 loop no longer reproduces the bug
- [ ] Fix matches the "correct behaviour" definition from the mental model

### Cleanup Checklist (Pillar 3)
- [ ] All [DEBUG-...] instrumentation removed (grep verified)
- [ ] Throwaway prototypes deleted
- [ ] Correct hypothesis stated in commit message
- [ ] Post-mortem: what would have prevented this?

### Verification Command (exact, runnable)

```bash
bun install --frozen-lockfile && bun run typecheck && bun run lint
bun test -t "T032"
bun test migrate save-ladder mcq review offline
bun test
grep -rnE "INTO cards|FROM cards" src tests e2e || echo "no cards table use left"
```

### Files Must NOT Touch

| File | Reason |
|------|--------|
| `.claude/**`, `agents/**`, `skills/**`, `templates/**`, `AGENTS.md`, `CLAUDE.md` | kit |
| `PRD.md`, `PROJECT_SPEC.md`, `PROJECT_KANBAN.md`, `memory/**`, `tasks/TASK_GUIDE_*` | Supervisor-owned |
| `migrations/0001`–`0011` | merged migrations are immutable |
| `card_states` / `review_log` schema, src/server/review.ts scheduling logic | not part of the defect |

### Evidence (filled by reviewer at Stage 4/5)

> **Moved.** Filled by the reviewer at Stage 4/5 in `tasks/TASK_REVIEW_T032.md`.

## Demonstration

> **Moved.** See `tasks/TASK_REVIEW_T032.md`.

---

## Questions Log

- 2026-11-19 DEBATE How do generated cards reach the review queue? → one table `review_cards`: migration 0012 adds nullable `position` + `chunk_id`, copies `cards` with a count check, drops `cards`; down never deletes `review_cards` rows (Advocate 1: one table, copy then drop `cards`, down deletes copied rows; Advocate 2: one table, copy then drop `cards`, down never deletes `review_cards` rows) ⚠ decided for you — please review
