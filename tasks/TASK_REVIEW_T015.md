# TASK_REVIEW — T015: Offline PWA (service worker cache), push reminders, export/import of progress

> Sibling of `tasks/TASK_GUIDE_T[NNN].md`. Everything here is **filled by the reviewer at Stage
> 4/5** — it is deliberately NOT in the guide, because the implementing agent re-reads the guide on
> every turn and never fills these two sections.
>
> Consumers resolve each section **guide first, this file second** (`.claude/hooks/lib/guide_sections.py`):
> a legacy guide that still carries these sections inline keeps working unchanged, and a stray
> review file can never override an inline section.

---

<!-- Optional: the final report, only for a task run in auto mode (the user's `[auto]` tag,
`docs/claude-md/tracks.md` `## Auto mode`). To use it, copy the block below out of this comment, to this
place, and replace every <...>. Keep `Mode: auto` as its first line, exactly as written: T182's hook reads
it. Write it to this file before the run ends; the chat message is a copy, not the report. The same
block is the Supervisor's final chat message. It is not the `delivery-report` page and not
Evidence. A taste decision (what the user wants) also ends with the flag. Write `DEBATED` only when ≥2
Advocate `Agent` calls ran for that question, naming each Advocate's option. A decision with no Advocates is
labelled `RULE`, `FACT` or `SAFER OPTION`, never `DEBATED`. A decision flagged `⚠ decided for you` is a choice, and is never labelled `FACT`. A
safety action a rule requires (for example the backup before a delete) is `RULE` without the flag.
At Risk Medium or High, a `RULE:` counts only when it names a written rule (`path:line`,
`path § <heading>`, or `docs/claude-md/tracks.md` `### <section>`), and a `FACT:` needs a Citation
(`path:line "quoted text"`); without one it is a choice and must be `DEBATED`. Good: `2. backed up the CSV
— RULE: `docs/claude-md/tracks.md` `### Stops that stay``. Bad: `1. kept recurring.csv — RULE: Surgical Changes`.
`Memory:` records the diff-driven memory pass you run before you stop: each entry written, or `nothing new`.
After an auto verify pass the hook, never you, adds `Closed: row moved to Done <date> — …` and moves the row,
or adds `Paused: done not moved — <reason>`. It moves the row only when this block holds `Mode: auto`, a
numbered decision, `Checks:`, `Memory:`, the `Not done:` auto verify slot with its result, and `Not done:`
naming the merge — no `<...>` left (`docs/claude-md/tracks.md` `### Auto close-out`).

## Auto decisions

Mode: auto
1. <what was decided> — RULE: <the rule>
2. <what was decided> — FACT: <path>:<line> "<quoted text>"
3. <what was decided> — DEBATED: <option> (Advocate 1: <its proposal>; Advocate 2: <its proposal>) ⚠ decided for you — please review
4. <what was decided> — SAFER OPTION: <why> ⚠ decided for you — please review
Paused: <only when a stop that stays paused the task: which one, and why>
Checks: tests `<command>` — <result>; reviews <skill — result>; real run `<command>` — printed `<what it printed>` (auto-checked, not /verify)
Memory: <each entry the memory pass wrote, as `file — entry` | nothing new>
Not done: merge (yours); <auto verify: running (T182) | auto verify: <result> | /verify (yours)>

-->

## Auto decisions

Mode: auto
1. Left the branch unmerged — RULE: `docs/claude-md/tracks.md` `### Never in auto mode`
2. Fixed the push endpoint check, a confirmed parser difference, with one safe change and a test — RULE: `.claude/skills/code-review/SKILL.md` § Phase 4 — Apply Safe Fixes
3. Left the P2 and P3 findings unfixed — RULE: `.claude/skills/code-review/SKILL.md` § Phase 4 — Apply Safe Fixes
Findings: P1 fixed: auto verify found that an import with a future `lastReview` was accepted and the next rating of that card gave a 500; imports with a date past server time + 5 minutes are now refused, and a rating never runs earlier than the last review; tests added. P1 fixed `src/push/subscriptions.ts:12` `https:fcm.googleapis.com/x` passed the host check, but web-push reads it with no host and would connect to localhost; run with Node to confirm, then closed. P2 `src/review/sync.ts:21` two devices: the guide edge case says ratings apply in `reviewedAt` order; they apply in arrival order, and an older rating gets server time. P2 `public/offline-store.js:195` sign-out deletes queued ratings even when the send failed, so they are lost on a server error. P3 a reminder subscription stays after sign-out (fixed text only). P3 never-rated cards count as due for the reminder. P3 the service worker has no fetch timeout on a bad connection. P3 a chunked import is read in full before the size check.
Checks: tests `pnpm test` and `pnpm test:e2e` — 180 unit and 53 browser tests passed; reviews code-review — 0 P0, 2 P1 fixed, 2 P2, 4 P3; migration-safety — GO, reversible, no downtime, additive, implementer dry run on 20,000 `review_log` rows took 120 ms and kept all rows; security-review — skill ran through a temporary `origin/HEAD` ref; no findings at confidence 8 or above, all named files read in full; one candidate at score 5 was confirmed and fixed; startup-reads check — pass, the report names `PROJECT_SPEC.md`, `tasks/TASK_GUIDE_T015.md`, `agents/frontend.md`; real run: `pnpm test:e2e` installs and runs the app in Chromium, offline included (auto-checked, not /verify)
Memory: memory/learnings.md — web-push reads endpoints with the legacy URL parser; memory/learnings.md — T015 unproven push paths
Not done: merge (yours); auto verify: running (T182); real push delivery (needs real VAPID keys and a push service; the verify run also could not reach `Turn on reminders` in headless Chromium, so that path is shown only with mocks); manual iPhone check; browser tests run with `tsx`, not the production build

---

## Evidence

| Check | Result | Notes / output snippet |
|-------|--------|------------------------|
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☑ pass | `test/t015-offline-sync.test.ts`, `test/t015-progress.test.ts`, `test/t015-push.test.ts`, `test/t015-web-push.test.ts`, `e2e/pwa.spec.ts`, `e2e/pwa-install.spec.ts`. Reviewer rerun 2026-11-01: `Test Files  16 passed (16)`, `Tests  180 passed (180)`; Playwright `53 passed (34.0s)`. |
| Verification command run | ☑ pass | Reviewer rerun in the worktree, exit codes checked: `pnpm install --frozen-lockfile` 0, `pnpm typecheck` 0, `pnpm lint` 0, `pnpm build` 0, `pnpm test`, `pnpm test:e2e`. Dependency ages: web-push 2024-01-16, zod 2026-10-12, @types/web-push 2024-10-22 (rule: at least 2 weeks old). `pnpm audit --prod`: 2 moderate, the two already recorded under T005. |
| Negative cases hold | ☑ pass | Tests pass: import with an evidence hash and L3 unlocked changes no other table, another learner's file 403, version 2 422, over 5 MB 413, future and old `reviewedAt` rejected, duplicate key one row, 404 and 410 delete a subscription, disallowed push hosts refused. |
| verify | ☑ fail | auto-run by hook, session b5d85330-32fc-4ff3-817c-b71614010138, commit b451106186de99bac857312c57b2f6af80704360, log .claude/verify-runs/T015-b451106186de.log — fail |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | ☑ pass | Reviewed the migration, `src/review/sync.ts`, `src/progress/transfer.ts`, `src/push/**`, `public/sw.js`, the `src/review/store.ts` and `src/app.tsx` diffs. `public/offline-store.js`, `public/pwa.js`, `public/settings.js` read in full by the security reviewer only. `lane_check`: `lane: C2, 41 files, 2624 lines, EXCEEDS (files 41 > 14; lines 2624 > 500)` plus an unpredicted list (warn-only; this task is near C3, label kept). Findings: P0 0, P1 2 fixed, P2 2, P3 4, listed under Auto decisions. |
| Full smoke suite still green (no regression) | ☑ pass | Same run: all earlier unit and browser tests pass; the T011 tests pass unchanged. |
| **Companion score (easy-verifier)** | ☑ N/A | The companion tool was not run for this task. |
| **UI: Visual regression (diff or verdict pasted)** | ☑ pass | Reviewer verdict after viewing `e2e/screenshots/pwa-offline-banner-mobile.png` and `pwa-settings-mobile.png`: banner says offline, card and `Show answer` visible, settings readable with no overflow — pass. Other screenshots viewed by the implementer only. |
| **UI: Design-system compliance (tokens/colors/typography verified)** | ☑ pass | `e2e/pwa.spec.ts` computed-style checks pass in the reviewer rerun; no new hex literal in `src` or `public/app.css` (implementer grep). |
| **UI: Responsiveness at target viewports** | ☑ pass | `e2e/pwa.spec.ts` at 360, 768 and 1280 px pass in the reviewer rerun; no horizontal scroll. |

---

## Demonstration

> Anchors what this task delivered to an observable before/after pair. BEFORE has no `N/A` path:
> if the task changes executable code, BEFORE is a pasted, timestamped terminal capture taken
> **before any implementation commit exists**; if it does not (docs, templates, skill-instruction
> text), BEFORE is the **verbatim prior content** of what changed — a quoted excerpt, not a command.

**BEFORE**: captured 2026-11-01T10:45:35Z on branch T015-offline-pwa at commit 49158be, before any T015 implementation commit. Command: `pnpm exec tsx before.mts` (builds `createApp` with the test config and requests each PWA route; script kept outside the repo):

```
BEFORE 2026-11-01T10:45:35.565Z
GET /manifest.webmanifest -> 404
GET /sw.js -> 404
GET /assets/pwa.js -> 404
GET /settings -> 404
GET /api/progress/export -> 404
```

**AFTER**: same command (plus `/offline`), 2026-11-01T10:59:24Z, after the change:

```
BEFORE 2026-11-01T10:59:24.469Z
GET /manifest.webmanifest -> 200
GET /sw.js -> 200
GET /assets/pwa.js -> 200
GET /settings -> 302
GET /api/progress/export -> 401
GET /offline -> 200
```

(`/settings` redirects to `/` and the export returns 401 because the script sends no session cookie; both routes exist.) Playwright run of `pnpm exec playwright test`: 53 passed, of which 8 are T015 (`e2e/pwa.spec.ts`, `e2e/pwa-install.spec.ts`).

**DELTA**: A learner can install the app, do the daily review with the network off (ratings queue on the device and sync on reconnect), turn on a daily reminder, and export or import review progress.

**WITNESS**: Supervisor reran the verification commands on 2026-11-01 in `.claude/worktrees/T015`; trace `memory/event-trace/T015.jsonl`.