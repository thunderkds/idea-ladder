# TASK_REVIEW — T006: Repo reader agent (3 read-only tools: list, read, search; step cap; token budget) picks core files; scored on golden set

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
1. Kept T006 In Progress and did not start auto verify, because AC 7 has no result and a cut never narrows an Acceptance Criterion — RULE: `AGENTS.md` § Karpathy Engineering Principles
2. Did not invent a Claude price or a golden-set score — RULE: `docs/claude-md/tracks.md` `### Never in auto mode`
3. Left the P2 and P3 findings unfixed — RULE: `.claude/skills/code-review/SKILL.md` § Phase 4 — Apply Safe Fixes
Paused: AC 7 needs `ANTHROPIC_API_KEY`, `MODEL_A_ID` and a real price for that model in `eval/prices.json`.
Findings: P1 open `src/reader/cost.ts:19` `eval/prices.json` holds only `test-model`, so every real model call fails the cost log and the failure is only printed; AC 6 is unmet in a real run until the price exists. P2 `src/reader/repo-tools.ts:155` one `search` can fetch 30 files, up to 15 steps, so one job can use more than GitHub's 60 unauthenticated calls per hour; a token is needed in real use. P2 `src/views.tsx:107` `fetched` renders as final, so a page that reloads in the short gap before `picking` stops updating. P2 `src/workflow/ladder-generate.ts:73` a transient model error repeats the whole loop, so up to 4 attempts at the budget are paid. P3 `repo_file_cache` is never trimmed.
Checks: tests `pnpm test` and eval `pnpm test` — 151 and 71 passed; reviews code-review — 0 P0, 1 P1 open, 3 P2, 1 P3; migration-safety — GO, reversible, no downtime, data lost only in the new tables on down, CHECK widening rescans a small table, production-copy check not applicable because no production data exists; security-review — RUNNING, not finished; startup-reads check — pass, the report names `PROJECT_SPEC.md`, `tasks/TASK_GUIDE_T006.md`, `agents/backend.md`; real run: `node dist/src/server.js` with a reader configured — printed `Idea Ladder listening on http://localhost:4078` (auto-checked, not /verify)
Memory: memory/learnings.md — the reader needs `GITHUB_APP_TOKEN` in real use; memory/decisions.md — token note corrected
Not done: merge (yours); auto verify: not started, waits for AC 7; AC 7 golden-set run (yours: needs the key); a real model run has never happened; browser tests on this branch

---

## Evidence

| Check | Result | Notes / output snippet |
|-------|--------|------------------------|
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☑ fail | `test/repo-reader.test.ts`, `test/pick-core-files.test.ts`, `eval/test/repo-reader.test.ts`. Reviewer rerun 2026-11-01: root `Tests  151 passed (151)`, eval `Tests  71 passed (71)`. AC 1–6 and 8 are covered with a mock model. AC 7 has no result: the paid golden-set run needs `ANTHROPIC_API_KEY`, so no score exists. |
| Verification command run | ☑ fail | Reviewer rerun: install, `pnpm typecheck`, `pnpm lint` exit 0, `pnpm test`, eval `pnpm test`, `pnpm build`; the built server starts with a reader configured. Not run: `pnpm eval -- --step core-files --subject repo-reader`. |
| Negative cases hold | ☑ pass | Tests pass: `../`, absolute and not-in-tree paths give tool errors; injection README adds no tool and keeps the schema; step cap and token budget stop the loop; invalid output ends `reader-invalid-output`. |
| verify | ☐ pass / ☐ fail / ☐ N/A | [what was observed — must literally state "pass" or "fail" here too, e.g. "skill run, feature confirmed working — pass": the merge gate scans this Notes column for the word "pass", not just the Result column] |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | ☑ pass | Reviewed `src/reader/**`, `src/workflow/ladder-generate.ts`, changed T005 files, migration, `eval/src/cli/eval.ts`. `eval/src/subjects/repo-reader.ts` not read by the Supervisor. `lane_check`: `lane: C2, 24 files, 1498 lines, EXCEEDS (files 24 > 14; lines 1498 > 500)` plus an unpredicted list (warn-only; a large C2, label kept). Findings: P0 0, P1 1 open, P2 3, P3 1, listed under Auto decisions. |
| Full smoke suite still green (no regression) | ☑ pass | Same run: all T003 and T005 unit tests pass. Browser tests not rerun on this branch, because the T010 verify run used the same e2e database. |
| **Companion score (easy-verifier)** | ☑ N/A | The companion tool was not run for this task. |
| **UI: Visual regression (diff or verdict pasted)** | ☐ N/A | No UI acceptance criteria in this guide; the only page change is one status heading, covered by unit tests. |
| **UI: Design-system compliance (tokens/colors/typography verified)** | ☐ N/A | No UI acceptance criteria in this guide; the only page change is one status heading, covered by unit tests. |
| **UI: Responsiveness at target viewports** | ☐ N/A | No UI acceptance criteria in this guide; the only page change is one status heading, covered by unit tests. |

---

## Demonstration

> Anchors what this task delivered to an observable before/after pair. BEFORE has no `N/A` path:
> if the task changes executable code, BEFORE is a pasted, timestamped terminal capture taken
> **before any implementation commit exists**; if it does not (docs, templates, skill-instruction
> text), BEFORE is the **verbatim prior content** of what changed — a quoted excerpt, not a command.

**BEFORE** (captured 2026-11-01T09:01:42Z, before any implementation commit; worktree T006 on branch T006-repo-reader):

```
$ cd eval && pnpm eval -- --step core-files --subject repo-reader
> tsx src/cli/eval.ts -- --step core-files --subject repo-reader
node:internal/modules/esm/resolve:272
    throw new ERR_MODULE_NOT_FOUND(
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../eval/src/subjects/repo-reader.ts' imported from .../eval/src/cli/eval.ts

$ pnpm test -- repo-reader pick-core-files      (no test file matches; no Postgres on localhost:54329, so the DB suites fail)
 Test Files  6 failed | 3 passed (9)
      Tests  41 passed | 69 skipped (110)
 ELIFECYCLE  Test failed.
```
There is no `repo-reader` eval subject, no `pickCoreFiles`, and no `pick-core-files` step in `ladder-generate`.

**AFTER** (2026-11-01T09:24Z, same worktree, after the change):

```
$ pnpm test            (root; Postgres container idea-ladder-db-1 on localhost:54329)
 Test Files  11 passed (11)
      Tests  151 passed (151)
$ pnpm test -- repo-reader pick-core-files    (vitest ignores the filter after "--"; it runs the whole suite, 11 files, 151 tests)
$ cd eval && pnpm test
 Test Files  7 passed (7)
      Tests  71 passed (71)
$ pnpm typecheck && pnpm lint         -> both exit 0
$ cd eval && pnpm eval -- --step core-files --subject repo-reader
Error: repo-reader needs ANTHROPIC_API_KEY and MODEL_A_ID in the environment (a live, paid run)
```
The eval subject now loads and stops with a clear message. The paid golden-set run (AC 7) did NOT run: ANTHROPIC_API_KEY is not set here. No score exists. Before the run, `eval/prices.json` needs a priced entry for MODEL_A_ID (source URL and date); the cost logger refuses an unpriced model.
Run when a key is available: `cd eval && ANTHROPIC_API_KEY=... MODEL_A_ID=... pnpm eval -- --step core-files --subject repo-reader` (writes `eval/reports/core-files-<stamp>.{json,md}` and `...-repo-reader-summary.md` with the per-repo table, means and the three VERDICT lines).

**DELTA**: A job now continues past fetch-repo into `pick-core-files`: a bounded three-tool reader on model A returns 3 to 10 validated core files with reasons, stored as ranked `core_files`, with every model call cost-logged and a ready golden-set command; without a model configured, the workflow still stops after fetch-repo.

**WITNESS**: backend-developer sub-agent run in worktree T006; confirm against `memory/event-trace/T006.jsonl`.
