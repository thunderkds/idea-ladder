# TASK_REVIEW — T011: Daily 5-minute review with FSRS (ts-fsrs 5.4.2), review log stored

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
2. Fixed the 5:00 cap, a broken AC 4 with one safe change and a test — RULE: `.claude/skills/code-review/SKILL.md` § Phase 4 — Apply Safe Fixes
3. Left the cache-hit gap open, because the fix adds a table and changes T010's AC 7 — RULE: `.claude/skills/code-review/SKILL.md` § Phase 4 — Apply Safe Fixes
Findings: P1 fixed `public/review.js` the 5:00 cap was only set on the timer tick, so a rating just after 5:00, or in a delayed background tab, showed a new card. P1 open `src/review/store.ts:36` a learner who reaches a ladder through a cache hit has no `generation_jobs` row, so the ladder has no reviews and is absent from My ladders; this is every learner after the first once T008 saves ladders. P2 `migrations/1762000002000_review-cards-fsrs.sql` has the same number as T006's migration, so T006 must take a later number at its merge. P2 `public/review.js` a 404 or 409 on a rating shows Retry, which can never work. P3 reloading `/review` restarts the 5:00 timer. P3 a NUL in an idempotency key gives a 500. P3 the migration comment says four tables; there are three.
Checks: tests `pnpm test` and `pnpm test:e2e` — 143 unit and 45 browser tests passed; reviews code-review — 0 P0, 1 P1 fixed, 1 P1 open, 2 P2, 3 P3; migration-safety — GO, reversible, no downtime, additive, `review_log` RESTRICT keys are deliberate, production-copy check not applicable because no production data exists; security-review — skill ran through a temporary `origin/HEAD` ref; no findings at confidence 8 or above, all named files read in full; startup-reads check — pass, the report names `PROJECT_SPEC.md`, `tasks/TASK_GUIDE_T011.md`, `agents/frontend.md`; real run: browser tests on the running app with a real Postgres (auto-checked, not /verify)
Memory: memory/learnings.md — T006 needs a new migration number; memory/learnings.md — cache-hit learners have no started record
Not done: merge (yours); auto verify: running (T182); cards are test data until T008; only L0 is open until T012 stores passes

---

## Evidence

| Check | Result | Notes / output snippet |
|-------|--------|------------------------|
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☑ pass | `test/review.test.ts`, `e2e/review.spec.ts`. Reviewer rerun 2026-11-01: `Test Files  12 passed (12)`, `Tests  143 passed (143)`; Playwright `45 passed (30.3s)`, including the reviewer-added late-tick test, which failed before the fix. |
| Verification command run | ☑ pass | Reviewer rerun in the worktree: `pnpm install --frozen-lockfile` printed `Done in 349ms`; `pnpm typecheck` exit 0; `pnpm lint` exit 0; `pnpm test`; `pnpm test:e2e`. ts-fsrs pinned `5.4.2`. |
| Negative cases hold | ☑ pass | Tests pass: 401 with no session, 404 for another ladder or a locked level, 409 for a reused key, same key writes one log row, UPDATE and DELETE on `review_log` are rejected, `Rating.Manual` is rejected. |
| verify | ☐ pass / ☐ fail / ☐ N/A | [what was observed — must literally state "pass" or "fail" here too, e.g. "skill run, feature confirmed working — pass": the merge gate scans this Notes column for the word "pass", not just the Result column] |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | ☑ pass | Reviewed the migration, `src/review/**`, `public/review.js`, `src/app.tsx` and `src/ladder/view.ts` diffs. `src/views.tsx` and tests read only by the security reviewer or through test runs. `lane_check`: `lane: C2, 25 files, 1265 lines, EXCEEDS (files 25 > 14; lines 1265 > 500)` (warn-only; screenshots and tests count). Findings: P0 0, P1 1 fixed, P1 1 open for your call, P2 2, P3 3, listed under Auto decisions. |
| Full smoke suite still green (no regression) | ☑ pass | Same run: all earlier unit and browser tests pass. |
| **Companion score (easy-verifier)** | ☑ N/A | The companion tool was not run for this task. |
| **UI: Visual regression (diff or verdict pasted)** | ☑ pass | Implementer viewed `e2e/screenshots/review-back-mobile.png` and `review-front-desktop.png` against the rubric — pass. The reviewer did not view them, and no vision model ran. |
| **UI: Design-system compliance (tokens/colors/typography verified)** | ☑ pass | `e2e/review.spec.ts` token, tap-target and gap checks pass in the reviewer rerun; no new hex literal in `src/` or `public/` (implementer grep). |
| **UI: Responsiveness at target viewports** | ☑ pass | `e2e/review.spec.ts` at 360, 768 and 1280 px pass in the reviewer rerun; no horizontal scroll. |

---

## Demonstration

> Anchors what this task delivered to an observable before/after pair. BEFORE has no `N/A` path:
> if the task changes executable code, BEFORE is a pasted, timestamped terminal capture taken
> **before any implementation commit exists**; if it does not (docs, templates, skill-instruction
> text), BEFORE is the **verbatim prior content** of what changed — a quoted excerpt, not a command.

**BEFORE**: (captured before any implementation commit)

```
BEFORE capture 2026-11-01T10:18:57Z on branch T011-daily-review @ 7637090
$ ls src/review
ls: cannot access 'src/review': No such file or directory
$ grep -c ts-fsrs package.json
0
$ pnpm exec vitest run -t T011
 RUN  v4.1.12 /home/hungnguyenhuu/workspace/pets/hungnguyen111/idea-ladder/.claude/worktrees/T011


 Test Files  11 skipped (11)
      Tests  128 skipped (128)
   Start at  17:18:57
   Duration  662ms (transform 808ms, setup 0ms, import 2.46s, tests 0ms, environment 1ms)
```

**AFTER**: 2026-11-01T10:25Z, same worktree, after the implementation commit:

```
$ pnpm exec vitest run -t T011      -> Test Files 1 passed | 11 skipped; Tests 15 passed | 128 skipped
$ pnpm exec playwright test --grep T011 -> 9 passed
$ pnpm install --frozen-lockfile    -> exit 0 ("Lockfile is up to date")
$ grep ts-fsrs package.json         -> "ts-fsrs": "5.4.2"
full suites: pnpm test 143 passed (12 files); pnpm exec playwright test 44 passed
```

**DELTA**: [one sentence — what a user can now do that they could not before]

**WITNESS**: Supervisor reran the verification commands on 2026-11-01 in `.claude/worktrees/T011`; trace `memory/event-trace/T011.jsonl`.