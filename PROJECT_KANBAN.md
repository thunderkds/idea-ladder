# PROJECT_KANBAN.md
**Last updated**: 2026-11-01 (phase tasks T003–T030 planned)

> Idea Ladder board (board mode `local`). Full context lives in `PROJECT_SPEC.md`.
> The previous file was another project's Linear cache; it is archived at `docs/archive/easy-personal-board/`.

---

## Board

> Task line format: **Txxx** — [title] | [agent] | C[0–3] | Risk: Low/Med/High | P[0–2]

### Todo
- [ ] **T003** — Scaffold — TypeScript app, Postgres + pgvector, migrations, GitHub OAuth sign-in, CI | common-infrastructure | C2 | Risk: Medium | P0 | Phase: v1 (after Gate 1)
- [ ] **T004** — Golden set of 20 hand-checked repos, eval harness, per-step cost logging | qa-expert | C2 | Risk: Low | P0 | Phase: v1 (after Gate 1)
- [ ] **T005** — /start?url= → read repo with token, pin SHA, cache by repo+SHA, background job (Inngest), status page | backend-developer | C2 | Risk: Medium | P0 | Phase: v1 (after Gate 1)
- [ ] **T006** — Repo reader agent (3 read-only tools: list, read, search; step cap; token budget) picks core files; scored on golden set | backend-developer | C2 | Risk: Medium | P0 | Phase: v1 (after Gate 1)
- [ ] **T007** — Concept mapper (3–6 concepts, structured output) + learner edits concepts | backend-developer | C2 | Risk: Low | P1 | Phase: v1 (after Gate 1)
- [ ] **T008** — Level generators in parallel from grounded chunks; answer-key code check; embedding dedupe; save ladder unverified | backend-developer | C3 | Risk: Medium | P0 | Phase: v1 (after Gate 1)
- [ ] **T009** — Blind solver (second provider), regenerate max 2; re-measure catch / false-reject on an independent seed set | backend-developer | C2 | Risk: Medium | P0 | Phase: v1 (after Gate 1)
- [ ] **T010** — Ladder view — L0–L4, locked levels, status unverified, link out to README/DeepWiki | frontend-developer | C2 | Risk: Low | P0 | Phase: v1 (after Gate 1)
- [ ] **T011** — Daily 5-minute review with FSRS (ts-fsrs 5.4.2), review log stored | frontend-developer | C2 | Risk: Medium | P0 | Phase: v1 (after Gate 1)
- [ ] **T012** — MCQ pass test — score vs stored keys, randomized pool, rate-limited retakes, append-only evidence record + SHA-256 | backend-developer | C2 | Risk: High | P0 | Phase: v1 (after Gate 1)
- [ ] **T013** — GitHub artifact verifiers — L2 branch, L4 repo or merged PR, L1 verifier design | backend-developer | C2 | Risk: High | P0 | Phase: v1 (after Gate 1) | HITL
- [ ] **T014** — Diff questions after L2 — generated from the learner's diff (model A), blind-solved (model B), pass 4 of 5 | backend-developer | C2 | Risk: High | P1 | Phase: v1 (after Gate 1)
- [ ] **T030** — Pass-test screens — MCQ attempt, artifact submit (L1/L2/L4), diff-question attempt, result view | frontend-developer | C2 | Risk: Medium | P0 | Phase: v1 (after Gate 1)
- [ ] **T015** — Offline PWA (service worker cache), push reminders, export/import of progress | frontend-developer | C2 | Risk: Medium | P1 | Phase: v1 (after Gate 1)
- [ ] **T016** — "This question seems wrong" flag; frequently flagged cards regenerated or removed | backend-developer | C1 | Risk: Low | P2 | Phase: v1 (after Gate 1)
- [ ] **T017** — Measure real cost per ladder on the golden set; set and enforce a cap with the user; provider prompt caching | backend-developer | C1 | Risk: Medium | P1 | Phase: v1 (after Gate 1) | HITL
- [ ] **T018** — Deploy v1 + Gate 2 metrics ("others finish L1 without help") | common-infrastructure | C2 | Risk: Medium | P1 | Phase: v1 (after Gate 1) | HITL
- [ ] **T019** — Signed credential (plain signed JSON, Ed25519) on ladder completion + revocation status list | backend-developer | C2 | Risk: High | P0 | Phase: v2 (after Gate 2)
- [ ] **T020** — Public verify page: checks signature, re-checks GitHub evidence live | frontend-developer | C2 | Risk: High | P0 | Phase: v2 (after Gate 2)
- [ ] **T021** — Shareable proof profile page | frontend-developer | C1 | Risk: Low | P1 | Phase: v2 (after Gate 2)
- [ ] **T022** — Concept ladders shared across repos (reuse by concept) | backend-developer | C2 | Risk: Medium | P1 | Phase: v2 (after Gate 2)
- [ ] **T023** — "Learn this" contract with Idea Radar (document + contract test of /start?url=) | backend-developer | C1 | Risk: Low | P2 | Phase: v2 (after Gate 2) | HITL
- [ ] **T024** — Upgrade proof to Open Badges 3.0 / W3C VC 2.0 | backend-developer | C3 | Risk: High | P2 | Phase: v2 (after Gate 2)
- [ ] **T025** — Community ladders content repo with CI schema validation | common-infrastructure | C2 | Risk: Medium | P1 | Phase: v3 (after Gate 3)
- [ ] **T026** — Sync community ladders into the app | backend-developer | C2 | Risk: Medium | P1 | Phase: v3 (after Gate 3)
- [ ] **T027** — Author credit: "N learners passed your ladder" | backend-developer | C1 | Risk: Low | P2 | Phase: v3 (after Gate 3)
- [ ] **T028** — Cohort mode: 5–10 people on one ladder, shared progress | frontend-developer | C3 | Risk: Medium | P2 | Phase: v3 (after Gate 3)
- [ ] **T029** — "Learn what's trending" weekly pick | backend-developer | C1 | Risk: Low | P2 | Phase: v3 (after Gate 3)

### In Progress

### Ready for Review

### Done
- [x] **T001** — Spike — measure the deterministic core (answer-key check, signed proof, GitHub read) | backend-developer | C2 | Risk: Medium | P0 | Started 2026-11-01: branch `T001-core-spike` | Completed: 2026-11-01 — verify pass (commit 4bc2c4c, same code at c0c587a); moved by Supervisor on user's merge request
- [x] **T002** — v0 experiment kit — 3 ladders, Anki import file, 14-day log | backend-developer | C1 | Risk: Low | P0 | Started 2026-11-01: branch `T002-v0-kit` | Done 2026-11-01: auto verify pass (session cfd34d50-d813-4517-8ce1-6a3b7fca5031, commit de5cb7a299a45e94293f1281da6317ab9c0ce244)

---

## Blocked

| Task | Reason | Waiting on |
|------|--------|-----------|
| v1 tasks T003–T018, T030 | Gate 1: review on ≥10 of 14 days and ladders usable | Owner's 14-day v0 run (T002 kit) |
| v2 tasks T019–T024 | Gate 2: others finish L1 without your help | v1 deployed (T018) + real learners |
| v3 tasks T025–T029 | Gate 3: proof links get shared; first outside ladder PR | v2 live |
| T013, T017, T018, T023 | Each stops for one user decision (L1 proof; cost cap; hosting; Radar button) | User |

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
| 5 Integration & Verify | ✅ Done — merged to main 2026-11-01 |
