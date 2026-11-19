# TASK_REVIEW — T013: GitHub artifact verifiers — L2 branch, L4 repo or merged PR, L1 rule

> Sibling of `tasks/TASK_GUIDE_T013.md`. Everything here is **filled by the reviewer at Stage
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
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☑ pass / ☐ fail | Filled by backend-developer (implementer; reviewer to confirm). AC 1, 2, 4, 5: `tests/verify-l2-branch.test.ts`; AC 3, 4, 5: `tests/verify-l4-artifact.test.ts`; AC 5: `tests/github-artifacts.test.ts`, `tests/artifact-routes.test.ts`; AC 6: `tests/l1-run-mcq.test.ts`, `tests/artifact-routes.test.ts` (run-feedback); AC 7: `tests/artifacts-no-llm.test.ts`; Success Criterion 7: `tests/artifact-url.test.ts`; migration 0014: `tests/artifacts-migration.test.ts`, `tests/migrate.test.ts`. Full suite `bun test --timeout 60000`: ` 593 pass` / ` 0 fail` / ` 3336 expect() calls` / `Ran 593 tests across 59 files. [72.19s]` |
| Verification command run | ☑ pass / ☐ fail | `bun install --frozen-lockfile && bun run typecheck && bun run lint && bun test -t "T013"` at 2026-11-19T11:42:30Z: `Checked 388 installs across 345 packages (no changes) [6.00ms]` / `$ tsc --noEmit` / `Checked 146 files in 77ms. No fixes applied.` / `check-tokens: 0 color literals outside src/client/tokens.css` / ` 64 pass` / ` 529 filtered out` / ` 0 fail` / ` 255 expect() calls` / `Ran 64 tests across 59 files. [7.76s]` |
| Negative cases hold | ☐ pass / ☐ fail | |
| verify | ☐ pass / ☐ fail / ☐ N/A | [what was observed — must literally state "pass" or "fail" here too, e.g. "skill run, feature confirmed working — pass": the merge gate scans this Notes column for the word "pass", not just the Result column] |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | ☐ pass / ☐ fail | [what was reviewed vs. skipped, and why] |
| Full smoke suite still green (no regression) | ☐ pass / ☐ fail | |
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

**BEFORE**: captured by backend-developer before the first implementation commit (HEAD 950b0bf), command
`date -u +%Y-%m-%dT%H:%M:%SZ; bun test -t "T013" 2>&1 | tail -4; ls migrations | grep 0014 || echo "no 0014 migration"; grep -n "MCQ_LEVELS\|POOL_LEVELS" src/server/level-generator.ts src/server/save-ladder.ts`

```
2026-11-19T11:28:26Z
bun test v1.4.4 (38afee6c8)

error: regex "T013" matched 0 tests. Searched 51 files (skipping 531 tests) [155.00ms]
no 0014 migration
src/server/save-ladder.ts:13:const POOL_LEVELS = new Set(["L0", "L3"]);
src/server/save-ladder.ts:44:  if (POOL_LEVELS.has(l.level) && l.mcqs.length < MIN_MCQ_POOL) flags.push("insufficient-pool");
src/server/level-generator.ts:26:const MCQ_LEVELS: ReadonlySet<LevelId> = new Set(["L0", "L3"]);
src/server/level-generator.ts:73:  const mcqs = MCQ_LEVELS.has(level)
```

**AFTER**: same command, after the last implementation commit (2643d03), by backend-developer

```
2026-11-19T11:42:38Z
 529 filtered out
 0 fail
 255 expect() calls
Ran 64 tests across 59 files. [9.89s]
0014_artifacts.down.sql
0014_artifacts.up.sql
src/server/save-ladder.ts:13:export const POOL_LEVELS: ReadonlySet<string> = new Set(["L0", "L1", "L3"]);
src/server/save-ladder.ts:44:  if (POOL_LEVELS.has(l.level) && l.mcqs.length < MIN_MCQ_POOL) flags.push("insufficient-pool");
src/server/level-generator.ts:27:export const MCQ_LEVELS: ReadonlySet<LevelId> = new Set(["L0", "L1", "L3"]);
src/server/level-generator.ts:78:  const mcqs = MCQ_LEVELS.has(level)
```
(`tail -4` cuts the ` 64 pass` line; the verification command run above shows it.)

**DELTA**: [one sentence — what a user can now do that they could not before]

**WITNESS**: [who ran it and when — derived from `memory/event-trace/Txxx.jsonl`, never the
implementing agent alone]
