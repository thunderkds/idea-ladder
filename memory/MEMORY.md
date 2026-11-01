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
- [Gate 5 trace gotcha](learnings.md#patterns) — hook counts `npm/pnpm test`, not `node --test`; keep test commands short
- [Source conflicts](learnings.md#requirement-clarifications) — 3 self-contradictions in the requirement doc; see docs/MAIN_FLOW.md § 5
- [Phase plan T003–T030](decisions.md#2026-11-01--phase-plan-t003t030) — v1 19 tasks, v2 6, v3 5; each phase waits for its gate
