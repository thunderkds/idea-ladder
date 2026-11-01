# TASK_REVIEW — T010: Ladder view — L0–L4, locked levels, status unverified, link out to README/DeepWiki

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
2. Recorded the partial role-guide read as a process finding with no code change, because a late full read cannot change committed work — RULE: `.claude/skills/code-review/SKILL.md` § Phase 0.5 — Entry-Point Reachability Check
3. Left the P2 and P3 findings unfixed — RULE: `.claude/skills/code-review/SKILL.md` § Phase 4 — Apply Safe Fixes
Findings: P1 process: the implementer read only the first 30 lines of `agents/frontend.md`, and skipped the guide's Complexity part. P2 `src/ladder/view.ts:107` `My ladders` lists only ladders whose job the learner started, so a learner who arrives through a cache hit cannot find the ladder again (AC 7 as written; needs a backend follow-up). P2 `src/ladder/view.ts:118` the README link is always `README.md`, so it is a 404 for a repo with `README.rst` or similar, because T005 stores no README path. P3 `src/ladder/view.ts:53` the `to_regclass` check runs on each request and must go when T008 adds `levels`.
Checks: tests `pnpm test` and `pnpm test:e2e` — 127 unit and 35 browser tests passed; reviews code-review — 0 P0, 1 P1 process, 2 P2, 1 P3; security-review not required at Risk Low; migration-safety not applicable, no schema change; startup-reads check — partial, see P1; real run: browser tests on the running app with a real Postgres (auto-checked, not /verify)
Memory: memory/learnings.md — T008 must match the `levels` columns T010 reads
Not done: merge (yours); auto verify: running (T182); HTML review report not generated; level content and passes are test data until T008 and T012

---

## Evidence

| Check | Result | Notes / output snippet |
|-------|--------|------------------------|
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☑ pass | `test/level-lock-state.test.ts`, `test/ladder-view.test.ts`, `e2e/ladder-view.spec.ts`. Reviewer rerun 2026-11-01: `Test Files  11 passed (11)`, `Tests  127 passed (127)`; Playwright `35 passed (34.7s)`. |
| Verification command run | ☑ pass | Reviewer rerun in the worktree: `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint` exit 0, `pnpm test`, `pnpm test:e2e`. `@axe-core/playwright` 4.14.0 published 2026-10-15 (rule: at least 2 weeks old). |
| Negative cases hold | ☑ pass | Tests pass: unknown and malformed ladder id give the 404 page; signed-out learner goes to sign-in and back to the same ladder; a return cookie that is not a UUID is ignored. |
| verify | ☐ pass / ☐ fail / ☐ N/A | [what was observed — must literally state "pass" or "fail" here too, e.g. "skill run, feature confirmed working — pass": the merge gate scans this Notes column for the word "pass", not just the Result column] |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | ☑ pass | Reviewed `src/ladder/**`, the `src/app.tsx` and `src/views.tsx` diffs, `package.json`. Skipped lockfile; `public/app.css` read through screenshots only. `lane_check`: `lane: C2, 13 files, 712 lines, EXCEEDS (lines 712 > 500)` with an unpredicted list (warn-only; tests and screenshots count). Findings: P0 0, P1 1 process, P2 2, P3 1, listed under Auto decisions. |
| Full smoke suite still green (no regression) | ☑ pass | Same run: all T003 and T005 unit and browser tests pass. |
| **Companion score (easy-verifier)** | ☑ N/A | The companion tool was not run for this task. |
| **UI: Visual regression (diff or verdict pasted)** | ☑ pass | Reviewer verdict after viewing `e2e/screenshots/ladder-view-mobile.png`: five levels in order, L0 open, L1–L4 locked with icon and text, badge, 7-character SHA, two link buttons, long word wraps — pass. Desktop, tablet and list screenshots were viewed by the implementer only. |
| **UI: Design-system compliance (tokens/colors/typography verified)** | ☑ pass | `e2e/ladder-view.spec.ts` token checks pass in the reviewer rerun; axe scan: 0 serious or critical violations (implementer report; same spec passed in the rerun). |
| **UI: Responsiveness at target viewports** | ☑ pass | `e2e/ladder-view.spec.ts` at 360, 768 and 1280 px pass in the reviewer rerun; no horizontal scroll. |

---

## Demonstration

> Anchors what this task delivered to an observable before/after pair. BEFORE has no `N/A` path:
> if the task changes executable code, BEFORE is a pasted, timestamped terminal capture taken
> **before any implementation commit exists**; if it does not (docs, templates, skill-instruction
> text), BEFORE is the **verbatim prior content** of what changed — a quoted excerpt, not a command.

**BEFORE**: captured 2026-11-01T09:19:11Z in the T010 worktree, before any implementation commit. Route `/ladders/:ladderId` does not exist, no `levelLockState`, no `getLadderView`, no `Open ladder` link:

```
$ pnpm exec tsx scratch-before.ts   # createApp(...).request('/ladders/6b416705-16ed-4e8b-8b73-8612f6049199')
GET /ladders/<id> -> 404 404 Not Found
$ pnpm test -- ladder-view level-lock-state   (the filter args were not applied by vitest; the whole suite ran, no ladder-view / level-lock-state test file exists)
 Test Files  9 passed (9)
      Tests  110 passed (110)
$ ls src   ->  app.tsx auth config.ts db.ts server.tsx start views.tsx workflow
```
Prior `My ladders` page body (src/views.tsx, `LaddersPage`): `<p class="muted">No ladders yet</p>` for every learner.

**AFTER**: 2026-11-01, T010 worktree, same commands after the change:

```
$ pnpm test      -> Test Files 11 passed (11) / Tests 127 passed (127)   (new: test/level-lock-state.test.ts, test/ladder-view.test.ts = 17 tests)
$ pnpm test:e2e  -> 35 passed   (new: e2e/ladder-view.spec.ts, 10 tests incl. axe scan with 0 serious/critical, 360/768/1280 no horizontal scroll)
GET /ladders/<seeded id> -> 200: 5 levels L0..L4, badge "Unverified", "6b41670", README link .../blob/<full sha>/README.md, DeepWiki link
GET /ladders/does-not-exist -> 404 "Ladder not found"
```
Screenshots: e2e/screenshots/ladder-view-{mobile,tablet,desktop}.png, e2e/screenshots/ladders-list-desktop.png.

**DELTA**: A signed-in learner can open `/ladders/:ladderId` and see L0 to L4 with goals and pass tests, only the first unpassed level open, status Unverified, the 7-char pinned SHA, and links to the README at that SHA and to DeepWiki; `My ladders` lists the ladders they started.

**WITNESS**: Supervisor reran the verification commands on 2026-11-01 in `.claude/worktrees/T010`; trace `memory/event-trace/T010.jsonl`.