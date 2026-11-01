# decisions.md — Cold Tier: Architectural & Infrastructure Decisions

> **Rules**: Supervisor-only writes. Each entry: `### YYYY-MM-DD — Title`, then **Decision**, **Why**, and **Files** (cite paths — the diff-driven pass greps this file by changed file path).

## Architecture

### 2026-11-01 — v0 runs as experiments only (Option B, narrowed)
**Decision**: No product code before roadmap Gate 1. v0 = the ladder kit (T002) + a throwaway LLM-free spike (T001) measuring the answer-key code check, signed evidence proof and GitHub read against pre-registered thresholds. FSRS spike cut (v0 uses Anki's FSRS).
**Why**: User asked to "evaluate, experiment the solution before apply"; source roadmap says v0 is no-code. 2-Advocate Debate, auto mode, not yet approved by the user.
**Files**: BRAINSTORMING_LOG.md, experiments/core-spike/, experiments/v0-kit/, tasks/TASK_GUIDE_T001.md, tasks/TASK_GUIDE_T002.md

## Infrastructure

### 2026-11-01 — Idea Ladder uses board mode local
**Decision**: The repo arrived with another project's Linear config (team HUN, project "") and board cache. Moved `.claude/board.json` → `.claude/board.linear.json.bak` and the cache + 149 HUN guides → `docs/archive/easy-personal-board/` (git-ignored). New local `PROJECT_KANBAN.md` with T-IDs. No Linear writes.
**Why**: Hard-Stop Gate 4 (one project per KANBAN); online pull would erase local rows. 2-Advocate Debate. Undo: restore the .bak, then `python3 scripts/board_sync.py pull`.
**Files**: .claude/board.linear.json.bak, PROJECT_KANBAN.md, docs/archive/easy-personal-board/, .gitignore
