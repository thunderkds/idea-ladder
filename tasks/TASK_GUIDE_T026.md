# TASK_GUIDE — T026: Sync community ladders into the app
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
6. C2: read `memory/codebase-map.md` (the app layout set by T003, once mapped). Read `tasks/TASK_GUIDE_T025.md` (content schema, `schemaVersion`, version-bump rule), `tasks/TASK_GUIDE_T022.md` (concept ladder tables, reuse lookup), `tasks/TASK_GUIDE_T005.md` (GitHub reads with the app token, Inngest jobs).

---

## Requirement (Pillar 1 — Adapt the requirement)

Architecture diagram: "Content repo (community ladders, CI) → Ladder API". § Repo to ladder engine: "Reuse or draft
concept ladders: existing community ladders are reused; missing ones are AI-drafted and marked unverified."; "ladder
per concept scales and lets the community improve one shared ladder". § Grill #9: "cards are original text only".
Architecture: "GitHub API (public): each app calls it on its own, with its own token."

**Restated intent** (Supervisor's interpretation):
> On a schedule and on demand, the app reads the community ladders repo at one pinned commit, validates every
> ladder file with the same schema as the repo's CI, and upserts valid ones as concept ladders that the reuse
> lookup prefers over AI drafts, without losing any learner's progress.

**Out of scope** (what this task explicitly does NOT do):
- Changing the content schema or the content repo (T025).
- Author credit counts (T027).
- Writing back to the content repo (no PRs from the app).
- Webhooks from GitHub (cut; schedule + manual trigger only).

**Requirement Refs**:
- FR-003: existing community concept ladders are reused instead of AI drafts
- NFR-006: synced cards are original text; rendered as text, never HTML
- NFR-009: GitHub reads respect rate limits and fail clearly, not partially
- NFR-005: the sync is a durable workflow step, retried on its own

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [ ] Restated intent confirmed to match the user's request (by Supervisor / user — not the implementing agent)
- [ ] Domain terms align with `PROJECT_SPEC.md` glossary (`grill-with-docs` run if terminology was fuzzy)
- [ ] Every Acceptance Criterion below traces to a line in the Requirement
- [ ] All Requirement Refs exist in `PRD.md` and are fully covered by the Acceptance Criteria above

> An agent must NOT start implementing until this gate is checked. If anything here is unclear,
> STOP and ask the Supervisor (Karpathy: Think Before Coding).

---

## Dependencies & Reachability

**Depends on**: T025 — the content repo scaffold, its `schema/concept-ladder.schema.json` with `schemaVersion`, and the example ladders used as sync fixtures
**Entry point**: `syncCommunityLadders` (Inngest function, cron + event `community-ladders/sync.requested`); manual trigger `pnpm sync-ladders`

> v3 task: planned only. Pickup waits for Gate 3 ("Proof links get shared; first outside ladder PR").

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | `syncCommunityLadders` resolves the default-branch head SHA of `COMMUNITY_LADDERS_REPO` (env, `owner/name`), reads every `ladders/*.yaml` at that SHA, and records the run `{ sha, startedAt, finishedAt, upserted, skipped, retired }`. A second run at the same SHA makes 0 DB writes to concept ladders. | "Content repo ... → Ladder API" |
| 2 | Each file is validated with the vendored schema of the same `schemaVersion` as T025. An invalid file is skipped with `{ file, errors }` in the run record; valid files in the same run are still synced. A file with an unknown `schemaVersion` is skipped `unsupported-schema`. | "CI-validated" content, no partial ladder |
| 3 | A valid file upserts a concept ladder by `slug` with status `community`, `version` from the file, `authors`, and the content SHA. A higher `version` creates a new version row; the old version stays so learners linked to it keep it. | "community improve one shared ladder" |
| 4 | When a community ladder and an AI draft (`unverified`) share a slug, `findConceptLadder` (T022) returns the community ladder for new repo ladders; existing repo ladders keep their linked version. | "existing community ladders are reused; missing ones are AI-drafted" |
| 5 | A file deleted from the repo marks its concept ladder `retired`: hidden from new lookups, still served to learners who have progress on it. No row is deleted. | keep learner progress |
| 6 | GitHub 403/429 with `x-ratelimit-remaining: 0` or a 5xx stops the run with status `failed` and the reason; no concept ladder is written in a failed run (all upserts commit in one transaction at the end). | NFR-009; NFR-005 |
| 7 | Card text and titles are stored as plain text; the ladder view renders them as text (a `<script>` in a card shows literally). | NFR-006; untrusted outside content |

---

## Evaluation & Acceptance (How we know the agent worked correctly)

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | Mocked GitHub serving T025's 2 example ladders at SHA `a` | 2 upserted, run record with SHA `a` | vitest (test DB) |
| 2 | Same SHA again | 0 writes | vitest |
| 3 | SHA `b` adds 1 invalid file | 1 skipped with errors; 2 unchanged | vitest |
| 4 | SHA `c` bumps one ladder to `version: 2` | new version row; learner linked to v1 still on v1 | vitest |
| 5 | SHA `d` deletes one ladder | `retired`; learner progress row intact | vitest |
| 6 | Mock 403 + `x-ratelimit-remaining: 0` mid-run | run `failed`, 0 concept ladder writes | vitest |
| 7 | AI draft `embeddings` + community `embeddings` | `findConceptLadder("embeddings")` returns the community one | vitest |

### Verification Command (exact, runnable)

```bash
pnpm install --frozen-lockfile && pnpm db:migrate && pnpm test -- community-sync && pnpm lint
```

### Evidence (filled by reviewer at Stage 4/5)

> **Moved.** Filled by the reviewer at Stage 4/5 in `tasks/TASK_REVIEW_T026.md`.

---

## Demonstration

> **Moved.** See `tasks/TASK_REVIEW_T026.md`.

---

## Approach

**Pattern reference**: T005's GitHub reader and Inngest job (token use, SHA pin, rate-limit errors), which follow `experiments/core-spike/src/github.ts` (`RateLimitError`, no partial snapshot); T022's concept ladder upsert.

**Vital slice**: read at one SHA → validate → transactional upsert, with idempotency by SHA.
**Cut list**:
- GitHub webhook on push (cron + manual trigger is enough at this scale)
- per-file diff sync (read all files; the repo is small)
- admin UI for sync runs (run record table + log)
- moderation queue (the content repo's PR review is the moderation)

Read the tree with one `git/trees/<sha>?recursive=1` call, then each blob; stop at 500 files or 5 MB total and
fail the run `too-large`. Vendor T025's schema file into the app with its `schemaVersion`; a test checks the
vendored copy equals the content repo fixture byte for byte. Status `community` sits between `unverified` (AI
draft) and any later `verified`. Run `Skill({ skill: "migration-safety" })` for the new status value, version
rows and the run table.

---

## Edge Case Checklist

- [ ] Default branch head moves during a run — the run reads only at the SHA resolved at start
- [ ] `COMMUNITY_LADDERS_REPO` unset — sync is a no-op with a log line, not an error loop
- [ ] Slug renamed in the repo (delete + add) — old retired, new created; no automatic progress move
- [ ] Same `version` but changed content (T025 CI bypassed) — skip `version-not-bumped`, keep the stored version
- [ ] YAML with aliases / huge file — parser limits, file skipped
- [ ] Two sync runs at the same time — a lock (Inngest concurrency key = repo) so only one runs
- [ ] Ladder retired, then re-added later — un-retire the same slug with the new version

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| Inngest functions folder (T005, app layout set by T003, see `memory/codebase-map.md` once mapped) | `syncCommunityLadders` cron + event |
| concept ladder module from T022 | status `community`, version rows, preference in `findConceptLadder` |
| new migration in T003's migrations folder | `community` status, `concept_ladder_versions`, `community_sync_runs` |
| vendored `concept-ladder.schema.json` from T025 | validation |
| `scripts/sync-ladders.ts` + `package.json` script | `pnpm sync-ladders` sends the event |
| `.env.example` | `COMMUNITY_LADDERS_REPO=` |
| tests `community-sync` + mocked GitHub fixtures | AC 1–7 |
| `tasks/TASK_REVIEW_T026.md` | Evidence (reviewer) |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `.claude/**`, `agents/**`, `skills/**`, `templates/**`, `AGENTS.md`, `CLAUDE.md` | kit |
| `PRD.md`, `PROJECT_SPEC.md`, `PROJECT_KANBAN.md` | Supervisor-owned |
| `experiments/**` | throwaway spikes |
| `community-ladders/**` | T025's content repo; vendor its schema, do not edit it |
| evidence record table and writer (T012) | append-only; read only |

---

## Test Plan

Integration tests on the test Postgres with a mocked GitHub serving fixture trees at SHAs `a`–`d`
(Success 1–7). Real run: point `COMMUNITY_LADDERS_REPO` at a test copy of T025's repo (or the fixture server),
run `pnpm sync-ladders`, paste the run record and the concept ladder rows.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run
- [ ] Security review: `Skill({ skill: "security-review" })` run (Medium risk — untrusted outside content)
- [ ] `Skill({ skill: "migration-safety" })` run (status value, version rows, run table)
- [ ] Lint passes (`pnpm lint`, `tsc --noEmit`)
- [ ] Tests written AND pass — output pasted into `tasks/TASK_REVIEW_T026.md` Evidence (Hard-Stop Gate 5)
- [ ] `Skill({ skill: "verify" })` run — headless auto verify
- [ ] Supervisor notified: task ready for Stage 4 review
