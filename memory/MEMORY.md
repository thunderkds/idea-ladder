# MEMORY.md — Hot-Tier Memory Index

> **Rules**: Supervisor-only writes. Max 42,000 characters — a ratchet: `/compact-memory` may lower
> it, never raise it to fit growth. One-line summaries + links to cold files.
> Each spawn prompt carries a slice of these lines (craft-spawn-prompt's memory_slice.py) and this
> path to read in full only when the slice falls short; the whole file is not pasted.
> Updated by the Supervisor — prompted by the PostToolUse hook on `git push` / `git merge` (diff-driven pass), or via the `/compact-memory` skill.

---

## Memory Architecture

- [decisions.md](decisions.md) — code + infra architectural decisions (the "why")
- [glossary.md](glossary.md) — canonical biz domain terms and core domain models
- [learnings.md](learnings.md) — specs/requirement clarifications, patterns, gotchas

---

## Index

<!-- Format: - [Title](cold-file.md#section) — one-line summary.
     Target ≤150 chars/entry. Advisory: reported by the size test, never enforced.
     The enforced gate is the 42,000-character whole-file budget above. -->
- [v0 = experiments only](decisions.md#2026-11-01--v0-runs-as-experiments-only-option-b-narrowed) — no product code before Gate 1; T001 spike + T002 kit
- [Board mode local](decisions.md#2026-11-01--idea-ladder-uses-board-mode-local) — Linear config backed up; old cache archived; T-IDs
- [T001 outcome](decisions.md#2026-11-01--v0-runs-as-experiments-only-option-b-narrowed) — key check alone fails (11.3% false-reject) → v1 needs 2nd check; proof + GitHub read keep
- [Gate 5 trace gotcha](learnings.md#patterns) — hook counts `npm/pnpm test`, not `node --test`; `bun test` added 2026-11-12
- [Source conflicts settled](decisions.md#2026-11-12--four-source-conflicts-settled-user) — user agreed to all 4 readings in docs/MAIN_FLOW.md § 5
- [Phase plan T003–T030](decisions.md#2026-11-01--phase-plan-t003t030) — v1 19 tasks, v2 6, v3 5; each phase waits for its gate
- [v1 stack](decisions.md#2026-11-12--v1-stack-bun-react-postgres--pgvector-claude-subscription-for-lesson-generation) — Bun + React/Vite + Postgres/pgvector; model A via Claude subscription until other learners, then API; model B always API
- [T004 merged](decisions.md#2026-11-12--t004-merged-golden-set-and-eval-harness) — 20 repos + eval/ harness; baseline recall 0.06; `usd: null` for claude-code is T008's job
- [T003 merged](decisions.md#2026-11-12--t003-merged-v1-app-scaffold) — Hono on Bun, own SQL migrations (down guarded), hand-written GitHub OAuth, React/Vite; T018 hardening list
- [Codebase Map](codebase-map.md) — structural snapshot: directory tree, entry points, blast-radius hotspots. Refresh via /map-codebase.
- [T005 merged](decisions.md#2026-11-12--t005-merged-start-repo--sha-cache-inngest-job-status-page) — /start + job + status page; per-learner limit; known gaps list (token drain, stuck queued job) for T018
- [T010 merged](decisions.md#2026-11-12--t010-merged-ladder-view-l0l4-lock-state-my-ladders-rows) — ladder view + `ladder_levels`; one unlock rule, passes via T012 seam; merge-gate gotchas in learnings
- [T011 merged](decisions.md#2026-11-12--t011-merged-daily-5-minute-review-fsrs-ts-fsrs-542-append-only-review-log) — /review + FSRS server schedule + append-only log (migration 0005); per-queue new-card cap; known gaps for T018
- [T015 merged](decisions.md#2026-11-12--t015-merged-offline-pwa-ordered-sync-push-reminders-progress-export-and-import) — offline PWA + ordered sync + push cron + export/import (migration 0006); decided-for-you list and known gaps; gotchas in learnings
