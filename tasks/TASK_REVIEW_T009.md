# TASK_REVIEW — T009: Blind solver (separate blind Claude call), regenerate max 2; re-measure catch / false-reject on an independent seed set

> Sibling of `tasks/TASK_GUIDE_T009.md`. Everything here is **filled by the reviewer at Stage
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
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☑ pass | tests/blind-solver.test.ts (AC 1, 4, 7), tests/blind-solver-step.test.ts (AC 3, 4, SC 3-5), tests/config.test.ts `model B (T009)` (AC 2), tests/seed-schema.test.ts (AC 5), tests/blind-solver-metrics.test.ts (AC 5-7, SC 6). Full run: `bun test --timeout 60000` -> 524 pass, 0 fail; `cd eval && bun test` -> 77 pass, 0 fail; `bun run test:e2e -- start-flow` -> 6 passed |
| Verification command run | ☑ pass (unit tests); live `eval:blind-solver` is the owner's | `bun test blind-solver seed-schema blind-solver-metrics save-ladder config` -> `81 pass |  0 fail |  825 expect() calls | Ran 81 tests across 7 files. [4.37s]`. `bun run typecheck` and `bun run lint` clean. `env -i PATH=/usr/bin:/bin bun run eval:blind-solver` (no `claude`) -> `eval:blind-solver cannot run; missing: the `claude` CLI is not installed or not on PATH (install Claude Code and sign in). No model call was made.` exit 1; with `MODEL_B_BACKEND=api` -> `missing: ANTHROPIC_API_KEY (MODEL_B_BACKEND=api); MODEL_B_ID (MODEL_B_BACKEND=api)`. No live model call was made. |
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

**BEFORE** (captured 2026-11-19T10:53:26Z, before any T009 implementation commit):

```
$ date -u +%Y-%m-%dT%H:%M:%SZ; bun test blind-solver seed-schema blind-solver-metrics 2>&1 | tail -4; grep -n "blind-solve" src/server/ladder-generate.ts || echo "no blind-solve step"
2026-11-19T10:53:26Z
62 files were searched [2.00ms]

note: Tests need ".test", "_test_", ".spec" or "_spec_" in the filename (ex: "MyApp.test.ts")

no blind-solve step
```

**AFTER** (2026-11-19T11:07:31Z, same command, post-change):

```
$ date -u ...; bun test blind-solver seed-schema blind-solver-metrics ...; grep -n blind-solve src/server/ladder-generate.ts
2026-11-19T11:07:31Z
 41 pass
 0 fail
 684 expect() calls
Ran 41 tests across 4 files. [2.06s]
1:// Background ladder generation (Inngest). Steps: fetch-repo (T005), pick-core-files (T006), map-concepts (T007), chunk, generate-level-L0..L4, check-and-dedupe, blind-solve (T009) and save-ladder (T008); later tasks append more.
7:import { BLIND_SOLVE_STEP, blindSolveLevels } from "./blind-solver.ts";
392:const LEVEL_STEP = /generate-level-L[0-4]|check-and-dedupe|blind-solve|save-ladder/;
519:      console.warn(JSON.stringify({ event: "blind-solve-error", jobId, repo, sha, error: String(err) }));
```

**DELTA**: [one sentence — what a user can now do that they could not before]

**WITNESS**: [who ran it and when — derived from `memory/event-trace/Txxx.jsonl`, never the
implementing agent alone]
