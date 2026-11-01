# TASK_GUIDE — T032: Record every learner who starts a ladder (cache hit and shared job)
**Date**: 2026-11-01
**Complexity Level**: C1
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
5. Note the **Complexity Level** above and apply the matching process from the Complexity matrix in `agents/backend.md`

---

## Requirement (Pillar 1 — Adapt the requirement)

**Source**: NFR-004 "the first learner pays generation, later learners reuse". T010 and T011 review findings: `startLadder` writes no row on a cache hit, and a learner who joins an open job is not `started_by`, so `listMyLadders` and `getReviewQueue` miss them.

**Restated intent**:
> Every signed-in learner who starts a ladder, by cache hit, by joining an open job or by creating the job, gets a stored record for that repo + SHA. `My ladders` and the review queue read that record.

**Out of scope**:
- Non-repo sources (T031 extends the key).
- Removing a ladder from `My ladders`.

**Requirement Refs**:
- NFR-004, US-001, FR-015

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [x] Restated intent confirmed to match the user's request (by Supervisor / user — not the implementing agent) — signed auto (Supervisor) 2026-11-01
- [x] Domain terms align with `PROJECT_SPEC.md` glossary
- [x] All Requirement Refs exist in `PRD.md` and are fully covered by the Acceptance Criteria above

> An agent must NOT start implementing until this gate is checked. If anything here is unclear,
> STOP and ask the Supervisor (Karpathy: Think Before Coding).

---

## Dependencies & Reachability

**Depends on**: T005 — `startLadder`; T010 — `listMyLadders`; T011 — `getReviewQueue`
**Entry point**: `GET /start?url=` and `POST /api/start`, read back by `My ladders` and `/review`

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | A learner whose `/api/start` is a cache hit sees that ladder on `My ladders` and can review its L0 cards. | NFR-004 |
| 2 | Two learners who start the same repo + SHA while the job is open both see the ladder once it is saved, whatever order they called in. | NFR-004 |
| 3 | Starting twice writes one record: one row on `My ladders`. | no duplicates |
| 4 | A learner who never started a ladder does not see it and cannot rate its cards (404). | T011 AC 7 |
| 5 | The existing `started_by` data is covered: the migration copies current rows into the new record. | no lost ladders |
| 6 | A failed record write fails the request; a learner never gets a job or ladder with no record. | consistency |

---

## Evaluation & Acceptance (How we know the agent worked correctly)

### Verification Command (exact, runnable)

```bash
docker compose up -d db
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm typecheck && pnpm lint
pnpm test
pnpm test:e2e
```

### Evidence (filled by reviewer at Stage 4/5)

> **Moved.** Evidence lives in `tasks/TASK_REVIEW_T032.md`.

---

## Demonstration

> **Moved.** The Demonstration block lives in `tasks/TASK_REVIEW_T032.md`.

---

## Approach

Table `ladder_learners (user_id, repo_full_name, commit_sha, started_at)`, primary key on all three key columns, keyed by repo + SHA so a record exists before the ladder row does. `startLadder` inserts with `ON CONFLICT DO NOTHING` in every path after the head is resolved. `listMyLadders` joins `ladders` on repo + SHA through this table. `generation_jobs.started_by` stays as written.

---

## Edge Case Checklist

- [ ] Job failed, learner starts again: still one record
- [ ] Learner row deleted: record goes with it (`ON DELETE CASCADE`)

---

## Files to Change (Predicted)

| File | Change |
|---|---|
| `migrations/1762000003000_ladder-learners.sql` | new table, copy of `started_by` rows |
| `src/start/service.ts`, `src/start/jobs.ts` | write the record |
| `src/ladder/view.ts` | read the record |
| `test/**` | tests above |

## Files Must NOT Touch

- `src/auth/**`, `public/**`, service worker files (T015)

---

## Test Plan

vitest integration tests on a real Postgres for AC 1–6. The existing T010 and T011 tests stay green.

---

## Completion Checklist

- [ ] Acceptance Criteria covered by new tests
- [ ] `migration-safety` run
- [ ] Final report ends with `Startup reads:`
