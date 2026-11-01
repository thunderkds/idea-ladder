# TASK_REVIEW — T003: Scaffold — TypeScript app, Postgres + pgvector, migrations, GitHub OAuth sign-in, CI

> Sibling of `tasks/TASK_GUIDE_T003.md`. Everything here is **filled by the reviewer at Stage
> 4/5** — it is deliberately NOT in the guide, because the implementing agent re-reads the guide on
> every turn and never fills these two sections.
>
> Consumers resolve each section **guide first, this file second** (`.claude/hooks/lib/guide_sections.py`):
> a legacy guide that still carries these sections inline keeps working unchanged, and a stray
> review file can never override an inline section.

---

## Auto decisions

Mode: auto
1. Left the branch unmerged and did not start wave 2 (T005 needs T003 merged) — RULE: `docs/claude-md/tracks.md` `### Never in auto mode`
2. Dropped the trial merge of T003 + T004 after the merge gate blocked it, and did not retry it another way — RULE: `docs/claude-md/tracks.md` `### Stops that stay`
3. Left the real GitHub sign-in run open: no OAuth app credentials exist in this session — RULE: `docs/claude-md/tracks.md` `### Stops that stay`
4. Left the P3 findings unfixed — RULE: `.claude/skills/code-review/SKILL.md` § Phase 4 — Apply Safe Fixes
Paused: the merge gate blocked a trial merge (`Tasks still In Progress: T004, T003`); that check did not run. The real GitHub sign-in run waits for an OAuth app.
Findings: P1 (raised from P2 after auto verify reproduced the crash on commit b0f29c0) `src/db.ts:4` the pool had no `error` listener, so a dropped idle connection stopped the process — FIXED with `pool.on('error', ...)`; red-then-green test `test/db.test.ts`. P3 `src/auth/session.ts` expired sessions are never deleted. P3 `.github/workflows/ci.yml` actions are pinned by tag, not by SHA.
Checks: tests `pnpm ci:local` — printed `ci:local passed`, 25 unit and 7 browser tests; reviews code-review — 0 P0, 1 P1 (fixed), 0 P2, 2 P3; migration-safety — GO, reversible, no downtime, no data at risk, production-copy check not applicable because no production data exists; security-review — no finding at confidence 8 or above, after a temporary local `origin/HEAD` ref at `main` let the skill start (the remote is named `github`; ref removed afterwards); logout CSRF rejected at confidence 4, a forced sign-out only; startup-reads check not possible, the implementer report is in the earlier session; real run: not on real GitHub (auto-checked, not /verify)
Memory: memory/learnings.md — `security-review` needs `origin/HEAD`; merge gate also blocks trial merges
Not done: merge (yours); auto verify: ☑ fail (session d4500807-115b-4bb7-b521-bfe786b024ad, commit b0f29c032f8de2bdbf65d2926d0407fbfbad8bfa, log .claude/verify-runs/T003-b0f29c032f8d.log); real GitHub sign-in run (yours); Gate 1 ruling (yours): `PROJECT_SPEC.md` § Critical Constraints still says no v1 product code before Gate 1

---

## Evidence

| Check | Result | Notes / output snippet |
|-------|--------|------------------------|
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☑ pass | `test/config.test.ts`, `test/migrations.test.ts`, `test/auth.test.ts`, `test/tokens.test.ts`, `e2e/sign-in.spec.ts`, `e2e/ui.spec.ts`. Reviewer rerun 2026-11-01T11:58: `Test Files  4 passed (4)`, `Tests  24 passed (24)`, Playwright `7 passed (2.8s)`. After the P1 fix: `test/db.test.ts` added, `Tests  25 passed (25)`, Playwright `7 passed (2.8s)`, `ci:local passed`. |
| Verification command run | ☑ pass | Reviewer rerun of `pnpm ci:local` (install, migrate up/down/up, typecheck, lint, test, test:e2e): exit 0, last line `ci:local passed`. `pnpm audit --prod`: `No known vulnerabilities found`. Six sampled dependencies published 2026-10-15 or earlier (rule: at least 2 weeks before 2026-11-01). |
| Negative cases hold | ☑ pass | `test/auth.test.ts` passes: mismatched/missing/expired/foreign-signed state, failed token exchange, access_denied and replay each return 400 with users and sessions counts unchanged; forged session cookie redirects. |
| verify | ☑ fail | auto-run by hook, session d4500807-115b-4bb7-b521-bfe786b024ad, commit b0f29c032f8de2bdbf65d2926d0407fbfbad8bfa, log .claude/verify-runs/T003-b0f29c032f8d.log — fail |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | ☑ pass | Reviewed `src/**`, migration, tests, CI, compose and config (diff of `main...HEAD`). Skipped lockfile and PNG bytes; two screenshots viewed. `lane_check`: `lane: C2, 42 files, 1432 lines, EXCEEDS (files 42 > 14; lines 1432 > 500)` (warn-only; a first scaffold, label kept). Findings: P0 0, P1 1 (fixed), P2 0, P3 2, listed under Auto decisions. |
| Full smoke suite still green (no regression) | ☑ pass | Same `pnpm ci:local` run: all unit and browser tests pass. No earlier app code exists to regress. |
| **Companion score (easy-verifier)** | ☑ N/A | The companion tool was not run for this task. |
| **UI: Visual regression (diff or verdict pasted)** | ☑ pass | Reviewer verdict after viewing `e2e/screenshots/ladders-mobile.png` and `e2e/screenshots/home-desktop.png`: heading `My ladders`, `No ladders yet`, login `octo`, Sign out; one `Sign in with GitHub` button, app name, no overflow — pass. |
| **UI: Design-system compliance (tokens/colors/typography verified)** | ☑ pass | `e2e/ui.spec.ts` computed-style test and `test/tokens.test.ts` pass in the reviewer rerun. |
| **UI: Responsiveness at target viewports** | ☑ pass | `e2e/ui.spec.ts` at 360, 768 and 1280 px pass in the reviewer rerun; no horizontal scroll. |

---

## Demonstration

> Anchors what this task delivered to an observable before/after pair. BEFORE has no `N/A` path:
> if the task changes executable code, BEFORE is a pasted, timestamped terminal capture taken
> **before any implementation commit exists**; if it does not (docs, templates, skill-instruction
> text), BEFORE is the **verbatim prior content** of what changed — a quoted excerpt, not a command.

**BEFORE**: `2026-11-01T11:08:23+07:00 $ ls package.json pnpm-workspace.yaml` → `ls: cannot access 'package.json': No such file or directory
ls: cannot access 'pnpm-workspace.yaml': No such file or directory` (exit 2)

**AFTER**: `2026-11-01T11:15 $ ls package.json pnpm-lock.yaml docker-compose.yml .github/workflows/ci.yml` lists all four (exit 0); `pnpm ci:local` ends `ci:local passed`.

**DELTA**: A learner can sign in with GitHub (against the test stub; real GitHub run is open) and see an empty `My ladders` page, on a migrated Postgres + pgvector, with CI that runs the same checks.

**WITNESS**: Supervisor reran `pnpm ci:local` on 2026-11-01T11:58 in `.claude/worktrees/T003`; trace `memory/event-trace/T003.jsonl`.