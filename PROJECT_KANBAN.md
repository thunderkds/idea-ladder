# PROJECT_KANBAN.md
**Last updated**: 2026-11-01

> Idea Ladder board (board mode `local`). Full context lives in `PROJECT_SPEC.md`.
> The previous file was another project's Linear cache; it is archived at `docs/archive/easy-personal-board/`.

---

## Board

> Task line format: **Txxx** — [title] | [agent] | C[0–3] | Risk: Low/Med/High | P[0–2]

### Todo

### In Progress

### Ready for Review
- [ ] **T001** — Spike — measure the deterministic core (answer-key check, signed proof, GitHub read) | backend-developer | C2 | Risk: Medium | P0 | Started 2026-11-01: branch `T001-core-spike`

### Done
- [x] **T002** — v0 experiment kit — 3 ladders, Anki import file, 14-day log | backend-developer | C1 | Risk: Low | P0 | Started 2026-11-01: branch `T002-v0-kit` | Done 2026-11-01: auto verify pass (session cfd34d50-d813-4517-8ce1-6a3b7fca5031, commit de5cb7a299a45e94293f1281da6317ab9c0ce244)

---

## Blocked

| Task | Reason | Waiting on |
|------|--------|-----------|
| v1 MVP (not yet split) | Roadmap Gate 1: review on ≥10 of 14 days and ladders usable; PRD Open Questions 1–6 | Owner's 14-day v0 run (T002 kit) + answers |

---

## Stage Tracker

| Stage | Status |
|-------|--------|
| 0.5 Brainstorming | ✅ Done (auto; approval pending) |
| 1 Environment Setup | ✅ Done |
| 1.5 Sub-Agent Architecture | ✅ Done (base team) |
| 2 Planning (/plan) | ✅ Done |
| 3 Execution | ✅ Done |
| 4 Review | ✅ Done |
| 5 Integration & Verify | 🔄 verify pass (T001, T002); merge waits for the user |
