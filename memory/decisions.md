# decisions.md — Cold Tier: Architectural & Infrastructure Decisions

> **Rules**: Supervisor-only writes. Each entry: `### YYYY-MM-DD — Title`, then **Decision**, **Why**, and **Files** (cite paths — the diff-driven pass greps this file by changed file path).

## 2026-11-01 — v1 includes ladders from any URL, as concept-only ladders

**Decision**: v1 builds T031: a public non-GitHub URL gets a concept-only ladder (L0 generated, L1–L4 skipped). `GITHUB_APP_TOKEN` stays optional in config, but the T006 reader needs it in real use (memory/learnings.md).
**Why**: `docs/REQUIREMENT_SOURCE.md` lists "Ladder from any URL (repo, doc, article)" as MVP, but no task built it. The user asked why ideas were GitHub-only, then chose the recommended option. T008's concept-only path already exists, so T006 and T007 need no change. L1–L4 pass tests need a branch or PR.
**Files**: `tasks/TASK_GUIDE_T031.md`, `PRD.md`, `src/start/service.ts`

## 2026-11-01 — v1 build starts before Gate 1

**Decision**: The v1 build continues before Gate 1 passes. The 14-day v0 run no longer blocks T003–T018 and T030. Gate 2 and Gate 3 still hold.
**Why**: The user said "approve, and run all tasks in parrallel if possible", then replied "continue" when asked to merge wave 1 or hold it until Gate 1. The Supervisor read that reply as the ruling; the user can reverse it.
**Effect**: Merged T003 and T004 to local `main` (86a3dab), not pushed.

## Architecture

### 2026-11-01 — v0 runs as experiments only (Option B, narrowed)
**Decision**: No product code before roadmap Gate 1. v0 = the ladder kit (T002) + a throwaway LLM-free spike (T001) measuring the answer-key code check, signed evidence proof and GitHub read against pre-registered thresholds. FSRS spike cut (v0 uses Anki's FSRS).
**Why**: User asked to "evaluate, experiment the solution before apply"; source roadmap says v0 is no-code. 2-Advocate Debate, auto mode, not yet approved by the user.
**Files**: BRAINSTORMING_LOG.md, experiments/core-spike/, experiments/v0-kit/, tasks/TASK_GUIDE_T001.md, tasks/TASK_GUIDE_T002.md
**Outcome (2026-11-01, merged to main)**: T001 — answer-key code check FAIL (catch 96.9%, false-reject 11.3% > 10%; borderline, seed by implementer) → v1 needs a blind solver or entailment check; signed proof KEEP (17/17 tamper rejected); GitHub read KEEP (7 calls/repo). User confirmed v0 repos PocketFlow / mitt / dset. See experiments/core-spike/RESULTS.md.

### 2026-11-01 — Phase plan T003–T030
**Decision**: v1 = T003–T018 + T030 (19 tasks), v2 = T019–T024, v3 = T025–T029; full guides for every phase (user). Accounts from day one (GitHub OAuth, Postgres); Claude = model A, second provider = model B; cost cap set in T017 after measurement. Each phase is blocked by its roadmap gate.
**Why**: user answers 2026-11-01; roadmap gates (docs/REQUIREMENT_SOURCE.md § Diagram text).
**Files**: tasks/TASK_GUIDE_T003.md … tasks/TASK_GUIDE_T030.md, PROJECT_KANBAN.md, docs/PLAN_LOG.md, PRD.md

## Infrastructure

### 2026-11-01 — Idea Ladder uses board mode local
**Decision**: The repo arrived with another project's Linear config (team HUN, project "") and board cache. Moved `.claude/board.json` → `.claude/board.linear.json.bak` and the cache + 149 HUN guides → `docs/archive/easy-personal-board/` (git-ignored). New local `PROJECT_KANBAN.md` with T-IDs. No Linear writes.
**Why**: Hard-Stop Gate 4 (one project per KANBAN); online pull would erase local rows. 2-Advocate Debate. Undo: restore the .bak, then `python3 scripts/board_sync.py pull`.
**Files**: .claude/board.linear.json.bak, PROJECT_KANBAN.md, docs/archive/easy-personal-board/, .gitignore
