# TASK_REVIEW — T010: Ladder view — L0–L4, locked levels, status unverified, link out to README/DeepWiki

> Sibling of `tasks/TASK_GUIDE_T010.md`. Everything here is **filled by the reviewer at Stage
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
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☑ pass | `tests/level-lock-state.test.ts` (AC 2, SC 1-3), `tests/ladder-view.test.ts` (AC 1, 6, 7, SC 7; endpoints 401/404/no-store, return-to-ladder cookie), `tests/migrate.test.ts` (0004 up/down/up), `e2e/ladder-view.e2e.ts` (AC 3-7, SC 4-6, axe, tokens, 3 viewports). `bun test`: `143 pass, 0 fail` after the fix batch (new: `listLadders duplicates`, verified to fail with `DISTINCT` removed, then restored). `bun run test:e2e -- ladder-view`: `8 passed (7.1s)` (new: failed ladder request shows `Could not load this ladder`). |
| Verification command run | ☑ pass | `bun run ci:local` (re-run after the fix batch) ends `ci:local: all steps passed`: typecheck clean; lint `Checked 51 files ... No fixes applied.` + `check-tokens: 0 color literals outside src/client/tokens.css`; unit `143 pass 0 fail`; migrate up/down/up ok; e2e sign-in `3 passed`, start-flow `6 passed`, ladder-view `8 passed`. Guide's `bun test ladder-view level-lock-state` is covered by `bun test` (the two files are in it). |
| Negative cases hold | ☑ pass | Unknown/non-numeric/overflow ids give `undefined` (loader) and 404 (API + page: `Ladder not found`); signed-out API 401; signed-out page redirects to `/auth/github?next=%2Fladders%2F<id>` and returns to the ladder; look-alike return targets (`/ladders/42/x`, `//evil...`, CRLF) refused; `Cache-Control: no-store` on every ladder route; out-of-order passes do not open L3. |
| verify | ☑ pass | auto-run by hook, session 4c92cff9-4872-4aa4-a341-96ab2861655f, commit 1e9c8274adff6f4f60eac825d62cac94470a8c21, log .claude/verify-runs/T010-1e9c8274adff.log — pass |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | ☐ pass / ☐ fail | Not run by the implementer: `code-review` skill is not available in this sub-agent's tool set; Supervisor to run it. Blast radius for the reviewer: `src/server/app.ts` (new routes, `returnPath` replaces `startPath` and now also accepts `/ladders/<id>`), `src/client/App.tsx`, new `src/client/LadderView.tsx`, `src/shared/levels.ts`, `src/server/ladder-view.ts`, `migrations/0004_*`, `tests/migrate.test.ts` (hard-coded last-migration names), `e2e/serve.ts`, CI lists. |
| Full smoke suite still green (no regression) | ☑ pass | `bun run ci:local` all steps passed, including the earlier sign-in and start-flow e2e. |
| **Companion score (easy-verifier)** | ☐ pass / ☐ fail / ☐ N/A | [`overall` and `change_risk` as the tool returned them, the scope, the ref, and the absolute path of the verifier report after a literal `report:` label — e.g. "overall 86 (>= 80), change_risk pass, scope changes, ref `main...HEAD`, report: `/home/me/.easy-verifier-reports/kit/score_changes_20261028T0530Z.html`". The gate reads the path that follows `report:` and nothing else, so with no label, or a path that is absent, the row is unscored — write ☑ N/A instead. ☑ N/A with a reason when neither companion tool was run: the merge gate blocks on ☑ fail only, never on an absent or N/A row] |
| **UI: Visual regression (diff or verdict pasted)** | ☑ pass | Screenshots at 360/768/1280 in `test-results/screenshots/` (git-ignored): `ladder-view-no-passes-*`, `ladder-view-passed-*`, `ladder-view-fallback-*`, `ladders-two-*`. Verdict by the implementer plus the Supervisor, who looked at the mobile and desktop images and found them correct; not a separate vision run. Baselines are committed in `e2e/baseline/` (`ladder-view-no-passes-*`, `ladder-view-passed-*`, `ladder-view-fallback-*`, `ladders-two-*`, each mobile/tablet/desktop). Verdict: no passes, 1280: header with badge `Unverified`, `Pinned to 6b41670`, both link-out buttons, L0 in an accent-bordered card with `Open now`, L1-L4 muted with lock icon and `Locked — pass L<n-1> first`. Passed, 360 and 1280: L0/L1 `Passed`, L2 open, L3/L4 locked, 300+ char unbroken URL wraps inside the card. My ladders at 768: two rows with repo name and `Open ladder`.  |
| **UI: Design-system compliance (tokens/colors/typography verified)** | ☑ pass | `check-tokens: 0 color literals outside src/client/tokens.css`; Playwright computed-style checks in `e2e/ladder-view.e2e.ts` match `tokens.css` for open/locked/passed card colors, badge (size/weight/family/border), level title/goal type, `.levels` gap, card padding, `main` max-width. axe 0 serious/critical on all 4 ladder-view states, the 404 page, the load-error page and My ladders (axe-core 4.14.0 via `@axe-core/playwright` 4.14.0, exact pins, published 2026-10-05). |
| **UI: Responsiveness at target viewports** | ☑ pass | 360x740, 768x1024, 1280x800: `scrollWidth <= viewport` asserted for every screenshot; link-out buttons full width at 360 (asserted); at >= 1024 px the buttons sit beside the header. |

---

## Demonstration

> Anchors what this task delivered to an observable before/after pair. BEFORE has no `N/A` path:
> if the task changes executable code, BEFORE is a pasted, timestamped terminal capture taken
> **before any implementation commit exists**; if it does not (docs, templates, skill-instruction
> text), BEFORE is the **verbatim prior content** of what changed — a quoted excerpt, not a command.

**BEFORE**: captured 2026-11-12T09:28:06Z in the T010 worktree, before any implementation commit (`bun install --frozen-lockfile` done):

```
$ bun test ladder-view level-lock-state
bun test v1.4.3 (c6da4a4d3)
The following filters did not match any test files in --cwd="/home/thunderkds/workspace/pets/wt-t010":
 ladder-view level-lock-state
21 files were searched [2.00ms]
$ bun run test:e2e -- ladder-view --list
Listing tests:
Total: 0 tests in 0 files
error: script "test:e2e" exited with code 1
```

At this commit `GET /ladders/:ladderId` has no route (T005 redirects a cache hit there and it 404s), there is no `levelLockState`, no `getLadderView`, and `My ladders` renders only `No ladders yet`.

**AFTER**: 2026-11-12 (worktree wt-t010, after the last commit):

```
$ bun test level-lock-state ladder-view   (both files run inside the full `bun test`: 142 pass, 0 fail)
$ bun run test:e2e -- ladder-view
  ✓ SC 4: seeded ladder shows 5 levels L0-L4, Unverified badge, SHA 6b41670 and the two link-outs
  ✓ SC 5: keyboard reaches the open level; locked levels have nothing to focus and announce aria-disabled
  ✓ L0 and L1 passed: L2 open, L3 and L4 locked; a very long goal wraps at 360px
  ✓ SC 7: a ladder with no level rows shows five levels with `Not generated yet`
  ✓ SC 6: an unknown ladder id shows the 404 page
  ✓ AC 6: signed out, a ladder URL goes to sign-in and back to the same ladder
  ✓ AC 7: My ladders lists the saved ladders the learner started, each with Open ladder
  7 passed (6.2s)
$ bun run ci:local  ->  ci:local: all steps passed
```

**DELTA**: A signed-in learner can open `/ladders/:ladderId` from `My ladders` and see L0-L4 with goals, pass tests and lock state, the `Unverified` badge, the pinned SHA, and links to the README at that SHA and to DeepWiki.

**WITNESS**: [who ran it and when — derived from `memory/event-trace/Txxx.jsonl`, never the
implementing agent alone]
