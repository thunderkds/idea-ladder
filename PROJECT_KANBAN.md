# PROJECT_KANBAN.md
**Last updated**: 2026-11-19

> Idea Ladder board (board mode `local`). Full context lives in `PROJECT_SPEC.md`.
> The previous file was another project's Linear cache; it is archived at `docs/archive/easy-personal-board/`.

---

## Board

> Task line format: **Txxx** — [title] | [agent] | C[0–3] | Risk: Low/Med/High | P[0–2]

### Todo
- [ ] **T009** — Blind solver (second provider), regenerate max 2; re-measure catch / false-reject on an independent seed set | backend-developer | C2 | Risk: Medium | P0 | Phase: v1 (after Gate 1)
- [ ] **T012** — MCQ pass test — score vs stored keys, randomized pool, rate-limited retakes, append-only evidence record + SHA-256 | backend-developer | C2 | Risk: High | P0 | Phase: v1 (after Gate 1)
- [ ] **T013** — GitHub artifact verifiers — L2 branch, L4 repo or merged PR, L1 verifier design | backend-developer | C2 | Risk: High | P0 | Phase: v1 (after Gate 1) | HITL
- [ ] **T014** — Diff questions after L2 — generated from the learner's diff (model A), blind-solved (model B), pass 4 of 5 | backend-developer | C2 | Risk: High | P1 | Phase: v1 (after Gate 1)
- [ ] **T030** — Pass-test screens — MCQ attempt, artifact submit (L1/L2/L4), diff-question attempt, result view | frontend-developer | C2 | Risk: Medium | P0 | Phase: v1 (after Gate 1)
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

### Blocked

### Done
- [x] **T008** — Level generators in parallel from grounded chunks; answer-key code check; embedding dedupe; save ladder unverified | backend-developer | C3 | Risk: Medium | P0 | Phase: v1 (after Gate 1) | Started 2026-11-19: branch `T008-level-generators`, worktree `../wt-t008` ([admin], auto) · Ready for Review 2026-11-19: 22 commits on `T008-level-generators`; bun test 443 pass / 0 fail; code-review 0 P0/P1, 2 P2 fixed (d779933, 6ca472b), 4 P2 + 6 P3 cut list; security-review no findings; migration-safety GO (0008, 0009); golden-set run (SC 8) and live /start paused for OPENAI_API_KEY (owner); auto verify started | Done 2026-11-19: auto verify pass (session 3cebf764-5d5e-4633-868f-3799292c0e99, commit 3719d83186bd9582d8eeacacd14ad54940b2ec1b)
- [x] **T007** — Concept mapper (3–6 concepts, structured output) + learner edits concepts | backend-developer | C2 | Risk: Low | P1 | Phase: v1 (after Gate 1) | Started 2026-11-17: branch `T007-concept-mapper`, worktree `../wt-t007` ([admin]) · Ready for Review 2026-11-17: review fixes `4f9c3c9` `3d72565` `4af71d0`; golden run 20/20 mapped, 3,854 tokens/call, overlap 0.03 (exact-slug scorer, no threshold); auto verify started · 2026-11-19: first build lost (branch never pushed, clone not on this machine); user chose rebuild; back to In Progress on new branch `T007-concept-mapper` from main 467d538, worktree `../wt-t007` · Ready for Review 2026-11-19 (rebuild): 15 commits on `T007-concept-mapper`; bun test 359 pass / 0 fail; e2e concepts-edit + start-flow 17 passed; code-review 0 P0, P1 + 3 P2 fixed (4bcc80d 5cd665f 2218681 a5f47be), 6 P3 cut list; migration-safety GO; golden-set run (AC 7) and live /start are the owner's; auto verify started | Done 2026-11-19: auto verify pass (session 7623ab38-86e3-4868-9160-f7cb19f19a9b, commit 8434607c013fbde20763592b4b3fd173ad876b4d) | merged d7a6385 2026-11-19 (user); push is the owner's
- [x] **T006** — Repo reader agent (3 read-only tools: list, read, search; step cap; token budget) picks core files; scored on golden set | backend-developer | C2 | Risk: Medium | P0 | Phase: v1 (Gate 1 waived by user 2026-11-12) | Started 2026-11-12: branch `T006-reader` | Verify FAIL 2026-11-12 (paid golden-set run AC 7 / SC 6 not done); fix batch committed, waiting on the owner's run | Restarted 2026-11-12: user decision (the Claude subscription is the default model A back end, the API key is optional) adds AC 9, the `claude-code` back end for the reader; branch `T006-reader` first merges main | 2026-11-17: AC 7 rate-limit count done (e9f3c43, 3868745; 308 + 77 tests green); T007 guide aligned (d4a0300); golden-set run paused for the user's go-ahead (uses `gh` token + Claude subscription) | 2026-11-17: golden-set run (owner, bdeda6f) mean recall 0.79 PASS, 0 of 20 hit limit PASS; first run invalid (not logged in); to Ready for Review, auto verify started | Done 2026-11-17: auto verify pass (session f9f63bcf-2c4e-4d73-9d72-b8c0a81e5751, commit 45a96dcddf63454dc5f80d054366548063db9037) | merged cd46679 2026-11-17 ([admin]); push is the owner's (main is ahead of origin by this session's plan commits)
- [x] **T015** — Offline PWA (service worker cache), push reminders, export/import of progress | frontend-developer | C2 | Risk: Medium | P1 | Phase: v1 (Gate 1 waived by user 2026-11-12) | Started 2026-11-12: branch `T015-offline-pwa` | Done 2026-11-12: auto verify pass (session 64196178-692e-404e-8935-d32d82ea8c1b, commit 8220d62; the first run on 734baeb failed on a real stale-queue bug, fixed in 8220d62); code-review 0 P0/P1 open; security 0 findings; independent QA found and the fixes closed 1 P1 + 2 P2; migration-safety GO (dry-run N/A); real push delivery is the owner's manual check; merged 3f64cb8
- [x] **T011** — Daily 5-minute review with FSRS (ts-fsrs 5.4.2), review log stored | frontend-developer | C2 | Risk: Medium | P0 | Phase: v1 (Gate 1 waived by user 2026-11-12) | Started 2026-11-12: branch `T011-daily-review` | Done 2026-11-12: auto verify pass (session 34f68f99-705e-43e5-8fdc-11be0dbfc8eb, commit 42909c3) + manual /verify PASS on the running app; code-review 0 P0/P1; security 0 findings; QA PASS; migration-safety GO (dry-run N/A accepted by the user); merged 9162b6a
- [x] **T010** — Ladder view — L0–L4, locked levels, status unverified, link out to README/DeepWiki | frontend-developer | C2 | Risk: Low | P0 | Phase: v1 (Gate 1 waived by user 2026-11-12) | Started 2026-11-12: branch `T010-ladder-view` | Done 2026-11-12: auto verify pass (session 6da48ca5-e2ec-49cb-8cbd-41884726bf0d, commit ce131cd) + manual /verify PASS on the running app; code-review 0 P0/P1 (2 P2, 1 P3 open: lane label, locked text); merged 299a631
- [x] **T005** — /start?url= → read repo with token, pin SHA, cache by repo+SHA, background job (Inngest), status page | backend-developer | C2 | Risk: Medium | P0 | Phase: v1 (Gate 1 waived by user 2026-11-12) | Started 2026-11-12: branch `T005-start-job` | Done 2026-11-12: auto verify pass (session 2be86b0e-bc7e-4351-a859-6ea093a20ae9, commit fdd8580); code-review 0 P0/P1; security P1 fixed, re-review GO; merged 6d9da64
- [x] **T003** — Scaffold — TypeScript app, Postgres + pgvector, migrations, GitHub OAuth sign-in, CI | common-infrastructure | C2 | Risk: Medium | P0 | Phase: v1 (Gate 1 waived by user 2026-11-12) | Started 2026-11-12: branch `T003-scaffold` | Done 2026-11-12: auto verify pass (session eddf10a9-c600-4b5c-99ad-f21392bd3ac1, commit b688b44); code-review 0 P0/P1 after fix batch; security-review P1 fixed; merged d73e0d4
- [x] **T004** — Golden set of 20 hand-checked repos, eval harness, per-step cost logging | qa-expert | C2 | Risk: Low | P0 | Phase: v1 (Gate 1 waived by user 2026-11-12) | Started 2026-11-12: branch `T004-golden-set` | Done 2026-11-12: auto verify pass (session 5e1ab1ed-ec62-4aa3-b2bd-9519005bf20e, commit 082092d); code-review 0 P0/P1; merged 6982de5
- [x] **T001** — Spike — measure the deterministic core (answer-key check, signed proof, GitHub read) | backend-developer | C2 | Risk: Medium | P0 | Started 2026-11-01: branch `T001-core-spike` | Completed: 2026-11-01 — verify pass (commit 4bc2c4c, same code at c0c587a); moved by Supervisor on user's merge request
- [x] **T002** — v0 experiment kit — 3 ladders, Anki import file, 14-day log | backend-developer | C1 | Risk: Low | P0 | Started 2026-11-01: branch `T002-v0-kit` | Done 2026-11-01: auto verify pass (session cfd34d50-d813-4517-8ce1-6a3b7fca5031, commit de5cb7a299a45e94293f1281da6317ab9c0ce244)

---

## Blocked

| Task | Reason | Waiting on |
|------|--------|-----------|
| v1 tasks T005–T018, T030 | Gate 1 waived by user 2026-11-12; each waits only for its own dependencies | T003 scaffold (and T004 where noted) |
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
