# TASK_REVIEW — T030: Pass-test screens — MCQ attempt, artifact submit (L1/L2/L4), diff-question attempt, result view

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

## Evidence

| Check | Result | Notes / output snippet |
|-------|--------|------------------------|
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☑ pass | Written in this task: `tests/pass-test-client.test.ts` (11 bun tests: level → screen kind, reason-code text incl. AC 3/AC 5 wordings, T014 submit/retake problem text, review-cards link, diff poll rules 5 s / hidden pause / 10 min slow) and `e2e/pass-test.e2e.ts` (31 Playwright tests: entry, SC 1–9, AC 1–7, P2 fix, retake, edge cases, design). `bun test -t "T030"` → `11 pass / 0 fail / 55 expect() calls`; `bunx playwright test --grep T030` → `31 passed (37.0s)`. **Real handlers, no mocks:** SC 9 for L0 against T012 (test 18), and **SC 9 for L2 against the real T013 `verifyL2Branch` + real T014 `generateDiffQuestions` / `diffQuestionStatus` / `submitDiffAnswers`** (test 31: waiting state → 5 questions → 4 of 5 → "Level passed" → L2 passed, L3 open in the ladder view). It uses recorded GitHub fixtures (`tests/support/t013-github.ts`, `tests/support/t014-diff.ts`), scripted model A and mock model B, and no network. The other AC 4 cases (5 s poll interval, unavailable / not-testable, hidden pause, 10 min slow, retake 202/409/429, P2) use page.route mocks on the **real** T014 route shapes (`src/server/app.ts`, `src/server/diff-answers.ts`). |
| Verification command run | ☑ pass | Guide command at HEAD `0f28f7b` (main `655d5d3` merged in), 2026-11-25T04:38:12Z–04:38:53Z: `$ tsc --noEmit` (clean) · `$ biome check . && bun scripts/check-tokens.ts` → `Checked 162 files in 92ms. No fixes applied.` / `check-tokens: 0 color literals outside src/client/tokens.css` · `bun test -t "T030"` → ` 11 pass` ` 634 filtered out` ` 0 fail` ` 55 expect() calls` `Ran 11 tests across 64 files. [2.52s]` `bun test exit: 0` · `bunx playwright test --grep T030` → `playwright exit: 0` `Running 31 tests using 1 worker` … `✓  18 … T030 SC 9: an L0 attempt against the real T012 handlers passes and the ladder view shows L1 unlocked (893ms)` … `✓  27 … T030 P2: a failed diff submit keeps the 5 questions and answers, shows the reason, no \`Submit another branch\` (575ms)` … `✓  31 … T030 real server (no mocks), L2 › T030 SC 9 L2: a branch against the real T013/T014 handlers: waiting, 5 questions, 4 of 5 passes, L3 opens (6.0s)` `31 passed (37.0s)`. |
| Negative cases hold | ☑ pass | All in the 31 above: locked-level URL → "Pass the previous level first", 0 start requests (SC 7); 429 → "Next attempt at" in UTC+14 local time, no button until `retryAt` (SC 6); `pool-too-small` → "This level's test is not ready yet"; client 30:00 expiry and server `attempt-expired` → "This attempt expired" + `Start a new attempt`; offline → "You are offline — this needs a connection", nothing sent; network drop → "Not sent — try again", retry sends identical answers, no result shown; `already-submitted` → "Already submitted"; every T013 reason + `invalid-url` in plain words, raw code never shown; a server-sent `key` never reaches the page (AC 1); `diff-questions-unavailable` / `diff-not-testable` → reason + `Submit another branch`; **P2 fix:** a failed diff submit (409 `not-ready`) keeps the 5 questions and the chosen answers, shows the reason next to the form, no `Submit another branch`; resubmit sends identical answers; **retake:** after a failed set (result view or polled `failed`), `Try again with new questions` → 202 → waiting state; 429 `too-many-attempts` → "Next attempt at" in local time, no button; 409 `retake-not-allowed` in words. Hidden page pauses polling; 10 min → "Taking longer than usual" + `Check again`. Mutation check: disabling the `retryAt` re-enable made SC 6 fail. Disabling the double-click ref guard did NOT fail SC 1, because React disables the button synchronously; SC 1 still proves 1 request at user level. |
| verify | ☑ pass | auto-run by hook, session d77c566a-1480-4163-a0cf-47d157c3ff97, commit 515e855a9b946563e929c105dac0b1f4738c9d72, log .claude/verify-runs/T030-515e855a9b94.log — pass |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | ☐ pass / ☐ fail | Stage 4 (Supervisor). Affected set: `src/client/PassTest.tsx`, `src/client/pass-test.ts` (new); `src/client/App.tsx` (route), `src/client/LadderView.tsx` (`Take the test` on the open level), `src/client/Review.tsx` (`?cards=` filter, T011 screen), `src/client/styles.css`; `e2e/serve.ts`: real `passedLevels` except klona; `passer` seed; `learner-a` L2 seed; T013/T014 fixtures; in-process T014 workflow via the existing `emitArtifact` / `emitDiffRetake` injection points. No server, migration or kit file changed. **Known gap (left by decision):** `Review these cards` filters the review queue on the client (`/review?cards=`), so a linked card that is not due and not among the queue's new cards does not show. A fix needs a server change in T011's code, which is off limits for T030. |
| Full smoke suite still green (no regression) | ☐ pass / ☑ fail | **Not green, and not caused by T030: every failure also fails on the pre-T030 base `da0bcb4`.** Full Playwright at `0f28f7b`, 2026-11-25T04:38:58Z–04:41:00Z → `✘  57 e2e/pwa.e2e.ts:584:1 › T015 fix: a 401 on sync keeps the offline queue…` `✘  61 e2e/pwa.e2e.ts:743:1 › T015 fix: a fresh /review load online syncs the offline queue BEFORE…` ` 2 failed` ` 93 passed (2.0m)`. These 2 fail the same way at `da0bcb4` (throwaway worktree, 2026-11-24: `> 599 \|   await expect(page.getByText("Card 2 of 3")).toBeVisible();`, `> 755 \|   expect(ratedIds).toEqual(["203", "201"]);`). Full `bun test` (2026-11-24, at `2934ab8`) → ` 611 pass` ` 7 fail` ` 4 errors`: all 5 s timeouts in DB-heavy T012/T015 tests. The same 3 files fail at `da0bcb4` too (` 30 pass` ` 2 fail`, a different set), so they are environmental timeouts that existed before T030. After the main merge, T030 changed no server code and no bun test except `tests/pass-test-client.test.ts`. Follow-up for the Supervisor: the 2 PWA failures and the bun timeouts on this machine. |
| **Companion score (easy-verifier)** | ☑ N/A | Neither companion tool was run by the implementer. |
| **UI: Visual regression (diff or verdict pasted)** | ☑ pass | 27 baselines committed in `e2e/artifacts/T030/` at 360/768/1280: `mcq-intro`, `mcq-attempt`, `mcq-L1-feedback`, `artifact-L2-error`, `artifact-L4-error`, `result-pass`, `result-fail`, `diff-waiting`, `diff-questions` (`-360/-768/-1280.png`). LLM-vision verdict (implementer, opened `mcq-attempt-360`, `mcq-intro-360`, `mcq-L1-feedback-360/-1280`, `artifact-L2-error-360`, `result-pass-360`, `result-fail-768`, `diff-waiting-360`, `diff-questions-768`): "matches spec" — one question block per item, radio options readable and full width, progress "n of 10 answered" + timer visible, `Submit answers` at the end; error text directly under the field; pass shows the unlocked level and a link to it, fail shows "7 of 10 correct" and `Review these cards`, and neither looks like an error page; diff waiting shows "Making 5 questions on your code", then 5 questions. One defect found and fixed: on L1, `Take the test` touched the feedback box; a test now asserts a gap of at least 16 px. Diff screenshots come from mocked T014 data. |
| **UI: Design-system compliance (tokens/colors/typography verified)** | ☑ pass | Playwright computed-style vs `var(--token)` probe (`expectTokens`, tests 19–21, all ✓): `.test-submit` bg `--color-accent` / text `--color-accent-text`; `.question` bg `--color-surface`, border `--color-border`; `.options` row-gap `--space-2` (8 px); checked `.option` border `--color-accent`; `#artifact-error` color `--color-error`; `#artifact-url` border `--color-error`; `.result-pass` border + title `--color-accent`, bg `--color-surface`; `.result-fail` border `--color-border`, title `--color-text` (not an error colour); body `--font-family`, `--font-size-body`; `main` max-width `--content-max`. Pass/fail use text + icon (`.result-title svg` count 1 on both), not colour alone. Tap targets ≥ 44×44 asserted on every visible `.button`, `.option`, `.back-link`; min gap between options = 8 px (metric `"minGap":8`). Hex literals: `bun scripts/check-tokens.ts` → `check-tokens: 0 color literals outside src/client/tokens.css`. axe-core: 0 serious/critical on every screen above + locked, rate-limited, diff-unavailable, diff-slow. |
| **UI: Responsiveness at target viewports** | ☑ pass | 360/768/1280 on every screen (`designCheck`). Real metrics: `T030 metrics mcq-attempt 360px {"scrollWidth":360,"bodyFont":16,"mainLeft":0,"mainRight":0,"targets":42,"minGap":8,"optionFill":1}`, `… 768px {"scrollWidth":768,…,"mainLeft":64,"mainRight":64,…}`, `… 1280px {"scrollWidth":1280,…,"mainLeft":320,"mainRight":320,…}`. No horizontal scroll at any width, including a 480-char question/option and a very long branch URL. One centred column (left == right margin) at 768/1280; options fill the question width (`optionFill` 1) at 360. Keyboard-only run at 1280 completes an attempt (test 22). No overflow found. |

---

## Demonstration

> Anchors what this task delivered to an observable before/after pair. BEFORE has no `N/A` path:
> if the task changes executable code, BEFORE is a pasted, timestamped terminal capture taken
> **before any implementation commit exists**; if it does not (docs, templates, skill-instruction
> text), BEFORE is the **verbatim prior content** of what changed — a quoted excerpt, not a command.

**BEFORE**: captured by frontend-developer at HEAD `da0bcb4` (no T030 implementation commit yet), with the
guide's exact Verification Command, wrapped in UTC timestamps:

```
$ date -u; git rev-parse --short HEAD; bun install --frozen-lockfile && bun run typecheck && bun run lint && bun test -t "T030"; echo "bun test exit: $?"; bunx playwright test --grep T030; echo "playwright exit: $?"; date -u
2026-11-24T04:00:11Z
da0bcb4
bun install v1.4.4 (38afee6c8)

Checked 388 installs across 345 packages (no changes) [1055.00ms]
$ tsc --noEmit
$ biome check . && bun scripts/check-tokens.ts
Checked 152 files in 211ms. No fixes applied.
check-tokens: 0 color literals outside src/client/tokens.css
bun test v1.4.4 (38afee6c8)

error: regex "T030" matched 0 tests. Searched 61 files (skipping 608 tests) [2.43s]
bun test exit: 1
[WebServer] $ vite build
Error: No tests found

playwright exit: 1
2026-11-24T04:00:22Z
```

No pass-test screen exists: `src/client/LadderView.tsx` renders no `Take the test` control, and `src/client/App.tsx`
routes no test screen, so a learner cannot take any pass test from the UI.

**AFTER**: the same command, run by frontend-developer at HEAD `0f28f7b` (after merging main with T014):

```
2026-11-25T04:38:12Z
0f28f7b
bun install v1.4.4 (38afee6c8)

Checked 388 installs across 345 packages (no changes) [6.00ms]
$ tsc --noEmit
$ biome check . && bun scripts/check-tokens.ts
Checked 162 files in 92ms. No fixes applied.
check-tokens: 0 color literals outside src/client/tokens.css
bun test v1.4.4 (38afee6c8)

 11 pass
 634 filtered out
 0 fail
 55 expect() calls
Ran 11 tests across 64 files. [2.52s]
bun test exit: 0
playwright exit: 0

Running 31 tests using 1 worker
  ...
  ✓  18 e2e/pass-test.e2e.ts:467:3 › T030 real server (no mocks) › T030 SC 9: an L0 attempt against the real T012 handlers passes and the ladder view shows L1 unlocked (893ms)
  ...
  ✓  31 e2e/pass-test.e2e.ts:906:3 › T030 real server (no mocks), L2 › T030 SC 9 L2: a branch against the real T013/T014 handlers: waiting, 5 questions, 4 of 5 passes, L3 opens (6.0s)

  31 passed (37.0s)
2026-11-25T04:38:53Z
```

**DELTA**: A learner can now press `Take the test` on the open level and take its pass test from the ladder view. L0, L1 and L3 use an MCQ attempt; L4 uses a repo or PR link. L2 uses a branch link, then 5 questions on their own diff, served by the real T014 handlers. The result view shows the newly opened level after a pass. After a fail it shows the score, `Review these cards`, and for L2 `Try again with new questions`.

**WITNESS**: To be derived by the Supervisor from `memory/event-trace/T030.jsonl` (not the implementing agent alone).
