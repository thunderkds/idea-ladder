# TASK_REVIEW — T033: Thin MCQ pools — top-up rounds before save-ladder

> Sibling of `tasks/TASK_GUIDE_T033.md`. Everything here is **filled by the reviewer at Stage
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
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☑ pass | Implementer (backend-developer), 2026-11-25. New: `tests/mcq-top-up.test.ts`, 17 tests in 5 describe blocks starting "T033": `levelsNeedingTopUp` step plan (AC 1, AC 6, SC 5), `topUpMcqPools` rounds (AC 1, 3, 5, 6: 7+1 stops after round 1; 0 gained runs exactly 2 rounds; ≥8 and L2/L4 get no round; more than needed all kept), `generateTopUpMcqs` (AC 2: MCQs only, kept questions in the prompt, citation check), `checkTopUp`/`solveTopUp` (AC 2: key-check-failed after 2 regenerations, duplicate vs kept ladder, blind-solve-mismatch), and the real `ladderGenerateFunction` with `@inngest/test` + test Postgres: SC 1, SC 2, SC 3 (+ `startMcqAttempt` 422 `pool-too-small`), SC 4 (blind-solve throws in a round, retry, top-up generator called once), SC 5, edge "generator throws". Output: `17 pass / 635 filtered out / 0 fail / 74 expect() calls / Ran 17 tests across 64 files. [5.11s]` (full paste in the next row). Updated (expect the new steps their thin test pools now trigger): `tests/blind-solver-step.test.ts`, `tests/save-ladder.test.ts`, `tests/chunk.test.ts`, `tests/level-generator-step.test.ts`. |
| Verification command run | ☑ pass | 2026-11-25T05:06:03Z at eabe3da, `bun install --frozen-lockfile && bun run typecheck && bun run lint && bun test -t "T033"` → exit 0: `Checked 388 installs across 345 packages (no changes) [8.00ms]` / `$ tsc --noEmit` / `$ biome check . && bun scripts/check-tokens.ts` / `Checked 160 files in 96ms. No fixes applied.` / `check-tokens: 0 color literals outside src/client/tokens.css` / `bun test v1.4.4 (38afee6c8)` / ` 17 pass` / ` 635 filtered out` / ` 0 fail` / ` 74 expect() calls` / `Ran 17 tests across 64 files. [5.11s]` (stderr also holds the expected `top-up-generator-error` warn lines of the edge test and `job-cost-log-unreadable` lines of the default cost reader; omitted) |
| Negative cases hold | ☑ pass | In the passing run above: SC 2 — a top-up key not in the chunk → `key-check-failed`, a copy of a kept question → `duplicate`, a question model B disagrees with → `blind-solve-mismatch`; none saved (`topUp.dropped` = `{"key-check-failed":1,"duplicate":1,"blind-solve-mismatch":1}`). SC 3 — still 7 after 2 rounds → flag `insufficient-pool`, `startMcqAttempt` → `{ status: 422, error: "pool-too-small" }` (no bypass; `MIN_MCQ_POOL` unchanged, `src/server/mcq-test.ts` untouched). Edge — the top-up generator throws → round counted, 0 added, job `done`. Edge Case Checklist item 4 (job token budget): N/A — no token budget exists on the generation path (only the repo reader's `READER_TOKEN_BUDGET` in `pick-core-files`), so the top-up is bounded by `MCQ_TOP_UP_ROUNDS = 2` only. |
| verify | ☐ pass / ☐ fail / ☐ N/A | [what was observed — must literally state "pass" or "fail" here too, e.g. "skill run, feature confirmed working — pass": the merge gate scans this Notes column for the word "pass", not just the Result column] |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | ☐ pass / ☐ fail | [what was reviewed vs. skipped, and why] |
| Full smoke suite still green (no regression) | ☐ pass / ☐ fail | Implementer note, not a verdict: `bun test` (all files) at eabe3da → `650 pass / 2 fail / Ran 652 tests across 64 files. [112.73s]`. The 2 fails are `tests/offline-sync.test.ts` "batch limits and bodies…" [5051.98ms] and "at most 200 cards…" [5042.47ms]: 5 s timeouts under full-suite load on the shared test database; that file imports none of the changed modules and passes alone (`22 pass / 0 fail / Ran 22 tests across 1 file. [9.45s]`). An earlier full run also showed hook timeouts `(fail) (unnamed) [5000ms]` in unrelated files (progress, review-api, settings-page, start-ladder, push, start-ladder-limit, diff-questions); those 7 files then passed together: `92 pass / 0 fail / Ran 92 tests across 7 files. [22.56s]` (diff-questions not re-run alone). |
| **Companion score (easy-verifier)** | ☐ pass / ☐ fail / ☐ N/A | [`overall` and `change_risk` as the tool returned them, the scope, the ref, and the absolute path of the verifier report after a literal `report:` label — e.g. "overall 86 (>= 80), change_risk pass, scope changes, ref `main...HEAD`, report: `/home/me/.easy-verifier-reports/kit/score_changes_20261028T0530Z.html`". The gate reads the path that follows `report:` and nothing else, so with no label, or a path that is absent, the row is unscored — write ☑ N/A instead. ☑ N/A with a reason when neither companion tool was run: the merge gate blocks on ☑ fail only, never on an absent or N/A row] |
| **UI: Visual regression (diff or verdict pasted)** | ☐ pass / ☐ fail / ☐ N/A | [screenshot path or LLM verdict — required for UI tasks, Hard-Stop Gate 6] |
| **UI: Design-system compliance (tokens/colors/typography verified)** | ☐ pass / ☐ fail / ☐ N/A | [method used + output] |
| **UI: Responsiveness at target viewports** | ☐ pass / ☐ fail / ☐ N/A | [viewports tested, any overflow findings] |

---

## Demonstration

> Anchors what this task delivered to an observable before/after pair. BEFORE has no `N/A` path:
> if the task changes executable code, BEFORE is a pasted, timestamped terminal capture taken
> **before any implementation commit exists**; if it does not (docs, templates, skill-instruction
> text), BEFORE is the **verbatim prior content** of what changed — a quoted excerpt, not a command.

**BEFORE**: captured 2026-11-25T04:47:15Z in `wt-t033` at commit 013b100 (before any implementation commit),
command `bun install --frozen-lockfile && bun run typecheck && bun run lint && bun test -t "T033"`:

```
2026-11-25T04:47:15Z
290 packages installed [141.00ms]
$ tsc --noEmit
$ biome check . && bun scripts/check-tokens.ts
Checked 158 files in 113ms. No fixes applied.
check-tokens: 0 color literals outside src/client/tokens.css
bun test v1.4.4 (38afee6c8)

error: regex "T033" matched 0 tests. Searched 63 files (skipping 635 tests) [203.00ms]
```

`grep -rn "top-up\|MCQ_TOP_UP" src/server` printed nothing: no top-up exists; a level in `POOL_LEVELS` that
keeps fewer than 8 MCQs after check-and-dedupe and blind-solve goes straight to `save-ladder` as
`insufficient-pool`.

**AFTER**: 2026-11-25T05:06:03Z at eabe3da, the same command, exit 0:

```
Checked 388 installs across 345 packages (no changes) [8.00ms]
$ tsc --noEmit
$ biome check . && bun scripts/check-tokens.ts
Checked 160 files in 96ms. No fixes applied.
check-tokens: 0 color literals outside src/client/tokens.css
bun test v1.4.4 (38afee6c8)
 17 pass
 635 filtered out
 0 fail
 74 expect() calls
Ran 17 tests across 64 files. [5.11s]
```

**DELTA**: A ladder whose L0, L1 or L3 generation kept fewer than 8 checked MCQs now gets up to 2 top-up rounds (each question through the same key check, duplicate check and blind solve), so fewer levels end at `pool-too-small`; a level still thin is saved `insufficient-pool` as before.

**WITNESS**: [who ran it and when — derived from `memory/event-trace/T033.jsonl`, never the
implementing agent alone]
