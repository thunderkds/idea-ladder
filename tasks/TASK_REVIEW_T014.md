# TASK_REVIEW — T[NNN]: [Short Title]

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
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☑ pass | Written in this task: `tests/diff-questions.test.ts` (16 tests: SC 1-6, AC 1-7, edge cases sha-gone / rate limit / substring key / duplicate options / >500 chars / duplicate event, retake + rate limit, routes, migration 0015 up/down/up), `tests/diff-hunks.test.ts` (4 unit tests: splitter ids, lockfile/binary/dist-build-vendor filter, deleted-only diff, DIFF_TOKEN_BUDGET cap), fixtures + mocks `tests/support/t014-diff.ts`. Updated for 0015: `tests/migrate.test.ts`, `tests/artifacts-migration.test.ts`. Output: see next row (`20 pass, 0 fail`). |
| Verification command run | ☑ pass | backend-developer, 2026-11-24T05:18:43Z on `444c808`: `bun install --frozen-lockfile && bun run typecheck && bun run lint && bun test -t "T014"` → `Checked 388 installs across 345 packages (no changes)` / `$ tsc --noEmit` (no errors) / `Checked 158 files in 92ms. No fixes applied.` / `check-tokens: 0 color literals outside src/client/tokens.css` / `20 pass  608 filtered out  0 fail  172 expect() calls  Ran 20 tests across 63 files. [4.43s]`. The two `Inngest step error` blocks in the log are the intended failures of SC 4 (blind-solve throws once) and the rate-limit edge case (`RetryAfterError: github rate limit`, `retryAfter: "2026-11-24T09:10:00.000Z"`). |
| Negative cases hold | ☑ pass | In the run above: hunk id not in the diff, B disagreement, B disagrees in all 3 rounds (`diff-questions-unavailable`/`too-few-verified`, 0 served), lockfile-only diff (`diff-not-testable`, model mocks called 0 times), SHA gone (`sha-gone`), GitHub rate limit (RetryAfterError, set stays `generating`, no partial set), substring key / duplicate options / >500 chars rejected, invalid model A output spends one round, duplicate L2 event (1 set, 0 LLM calls), another learner's set 404, unknown question id 422, bad body 400, second submit 409 (nothing stored on any of them), retake on a non-failed set 409, 4th attempt in 24 h 429 + retryAt, new branch over the limit `too-many-attempts` with 0 LLM calls, scoring module imports no model module and no `ai`/`@ai-sdk` package, `fetch` spied to throw during scoring and never called. |
| verify | ☐ pass / ☐ fail / ☐ N/A | [what was observed — must literally state "pass" or "fail" here too, e.g. "skill run, feature confirmed working — pass": the merge gate scans this Notes column for the word "pass", not just the Result column] |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | ☐ pass / ☐ fail | [what was reviewed vs. skipped, and why] |
| Full smoke suite still green (no regression) | ☑ pass | backend-developer, 2026-11-24T05:17:13Z on `444c808`: `bun test` → `628 pass  0 fail  Ran 628 tests across 63 files. [82.21s]`. One earlier full run showed `T015 offline pack (AC 2) > at most 200 cards` timing out at 5 s (410 sequential inserts) plus an `Unhandled error between tests` from the background level-generator runs; re-run 2 of 2 green on this branch with the same 4 files, and green alone: a load-timing flake, not caused by this change (the test touches no T014 table). |
| **Companion score (easy-verifier)** | ☐ pass / ☐ fail / ☐ N/A | [`overall` and `change_risk` as the tool returned them, the scope, the ref, and the absolute path of the verifier report after a literal `report:` label — e.g. "overall 86 (>= 80), change_risk pass, scope changes, ref `main...HEAD`, report: `/home/me/.easy-verifier-reports/kit/score_changes_20261028T0530Z.html`". The gate reads the path that follows `report:` and nothing else, so with no label, or a path that is absent, the row is unscored — write ☑ N/A instead. ☑ N/A with a reason when neither companion tool was run: the merge gate blocks on ☑ fail only, never on an absent or N/A row] |
| **UI: Visual regression (diff or verdict pasted)** | ☑ N/A | Backend only: the answer screen is T030 (guide § Out of scope "Answer screen UI (server handlers only)"). |
| **UI: Design-system compliance (tokens/colors/typography verified)** | ☑ N/A | Backend only (no client file changed). |
| **UI: Responsiveness at target viewports** | ☑ N/A | Backend only (no client file changed). |

---

## Demonstration

> Anchors what this task delivered to an observable before/after pair. BEFORE has no `N/A` path:
> if the task changes executable code, BEFORE is a pasted, timestamped terminal capture taken
> **before any implementation commit exists**; if it does not (docs, templates, skill-instruction
> text), BEFORE is the **verbatim prior content** of what changed — a quoted excerpt, not a command.

**BEFORE**: captured by backend-developer at 2026-11-24T04:25:12Z on `3b34b16` (no T014 code yet), the guide's
verification command plus two absence checks:

```
$ date -u; git rev-parse --short HEAD
2026-11-24T04:25:12Z
3b34b16
$ bun install --frozen-lockfile && bun run typecheck && bun run lint && bun test -t "T014"
290 packages installed [270.00ms]
$ tsc --noEmit
$ biome check . && bun scripts/check-tokens.ts
Checked 152 files in 255ms. No fixes applied.
check-tokens: 0 color literals outside src/client/tokens.css
bun test v1.4.4 (38afee6c8)

error: regex "T014" matched 0 tests. Searched 61 files (skipping 608 tests) [232.00ms]
$ ls migrations | tail -2
0014_artifacts.down.sql
0014_artifacts.up.sql
$ grep -rn "diff-questions\|diff-question-sets" src/
src/shared/levels.ts:22:    passTest: { kind: "diff-questions", description: "Branch or diff link + questions generated from your diff" },
src/server/level-generator.ts:14:  L2: "branch-diff-and-diff-questions",
```

No T014 test, no diff-question migration, no `/api/artifacts/:artifactId/diff-questions` or
`/api/diff-question-sets/:setId/submit` route: a verified L2 branch (T013) sends `ladder/l2-artifact.verified`
and nothing consumes it, so L2 can never pass and L3 never unlocks.

**AFTER**: same command, 2026-11-24T05:18:43Z on `444c808`:

```
$ bun install --frozen-lockfile && bun run typecheck && bun run lint && bun test -t "T014"
Checked 388 installs across 345 packages (no changes) [6.00ms]
$ tsc --noEmit
$ biome check . && bun scripts/check-tokens.ts
Checked 158 files in 92ms. No fixes applied.
check-tokens: 0 color literals outside src/client/tokens.css
bun test v1.4.4 (38afee6c8)
 20 pass
 608 filtered out
 0 fail
 172 expect() calls
Ran 20 tests across 63 files. [4.43s]
$ ls migrations | tail -2
0015_diff_questions.down.sql
0015_diff_questions.up.sql
```

**DELTA**: after T013 verifies an L2 branch, the learner now gets 5 checked questions on their own diff, and 4 of 5 correct (scored in code) writes the L2 evidence record and unlocks L3; before, nothing consumed the L2 event and L2 could never pass.

**WITNESS**: [who ran it and when — derived from `memory/event-trace/T014.jsonl`, never the
implementing agent alone]
