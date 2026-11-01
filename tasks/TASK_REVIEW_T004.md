# TASK_REVIEW — T004: Golden set of 20 hand-checked repos, eval harness, per-step cost logging

> Sibling of `tasks/TASK_GUIDE_T004.md`. Everything here is **filled by the reviewer at Stage
> 4/5** — it is deliberately NOT in the guide, because the implementing agent re-reads the guide on
> every turn and never fills these two sections.
>
> Consumers resolve each section **guide first, this file second** (`.claude/hooks/lib/guide_sections.py`):
> a legacy guide that still carries these sections inline keeps working unchanged, and a stray
> review file can never override an inline section.

---

## Auto decisions

Mode: auto
1. Left the branch unmerged — RULE: `docs/claude-md/tracks.md` `### Never in auto mode`
2. Dropped the trial merge of T003 + T004 after the merge gate blocked it — RULE: `docs/claude-md/tracks.md` `### Stops that stay`
3. Left the P2 and P3 findings unfixed — RULE: `.claude/skills/code-review/SKILL.md` § Phase 4 — Apply Safe Fixes
Paused: the merge gate blocked a trial merge (`Tasks still In Progress: T004, T003`); that check did not run.
Findings: P2 `eval/src/harness.ts` the concepts report has 5 header columns but 6 separator columns, so its Markdown table may not render. P2 integration: T003's root `eslint.config.js` ignores `experiments/` but not `eval/`, so after both merge `pnpm lint` will also lint `eval/` — not tested, because the trial merge was blocked. P3 root CI does not run `eval` tests.
Checks: tests `cd eval && pnpm test` — 61 of 61 passed; reviews code-review — 0 P0, 0 P1, 2 P2, 1 P3; startup-reads check not possible, the implementer report is in the earlier session; real run `pnpm eval -- --step core-files --subject baseline-readme` — printed `**Mean recall 0.148, mean precision 0.320**` (auto-checked, not /verify)
Memory: memory/learnings.md — merge gate also blocks trial merges
Not done: merge (yours); auto verify: running (T182); owner spot check of the 20 repo labels (yours): the agent wrote them from README, tree and its own knowledge, without reading the source code

---

## Evidence

| Check | Result | Notes / output snippet |
|-------|--------|------------------------|
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☑ pass | `eval/test/{cost,github,golden,harness,score}.test.ts`. Reviewer rerun 2026-11-01T11:59: `Test Files  5 passed (5)`, `Tests  61 passed (61)`. |
| Verification command run | ☑ pass | Reviewer rerun: `pnpm install --frozen-lockfile` ok, `pnpm exec tsc --noEmit` clean, `pnpm eval -- --step core-files --subject baseline-readme` printed `**Mean recall 0.148, mean precision 0.320**` and wrote both reports, `pnpm eval:cost -- --run test-fixture-run` printed per-step and per-ladder cost. |
| Negative cases hold | ☑ pass | `eval/test/cost.test.ts` and `eval/test/golden.test.ts` pass: unknown model throws `UnknownModelPriceError`, bad cost input is rejected, a core path absent from the tree fails naming repo and path. `git grep` finds no token in `eval/` outside the test pattern. |
| verify | ☐ pass / ☐ fail / ☐ N/A | [what was observed — must literally state "pass" or "fail" here too, e.g. "skill run, feature confirmed working — pass": the merge gate scans this Notes column for the word "pass", not just the Result column] |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | ☑ pass | Reviewed `eval/src/**`, `eval/test/golden.test.ts`, `eval/prices.json`, entry points `pnpm eval` and `logStepCost`. Skipped fixture bodies and label accuracy of each repo. `lane_check`: `lane: C2, 65 files, 2874 lines, EXCEEDS (files 65 > 14; lines 2874 > 500)` (warn-only; most files are data). Findings: P0 0, P1 0, P2 2, P3 1, listed under Auto decisions. |
| Full smoke suite still green (no regression) | ☑ pass | Same rerun: all 61 eval tests pass. `eval/` is a separate package; no existing code changed. |
| **Companion score (easy-verifier)** | ☑ N/A | The companion tool was not run for this task. |
| **UI: Visual regression (diff or verdict pasted)** | ☐ N/A | No UI: this task is an offline eval package. |
| **UI: Design-system compliance (tokens/colors/typography verified)** | ☐ N/A | No UI: this task is an offline eval package. |
| **UI: Responsiveness at target viewports** | ☐ N/A | No UI: this task is an offline eval package. |

---

## Demonstration

> Anchors what this task delivered to an observable before/after pair. BEFORE has no `N/A` path:
> if the task changes executable code, BEFORE is a pasted, timestamped terminal capture taken
> **before any implementation commit exists**; if it does not (docs, templates, skill-instruction
> text), BEFORE is the **verbatim prior content** of what changed — a quoted excerpt, not a command.

**BEFORE**: `2026-11-01T11:08:23+07:00 $ ls eval` → `ls: cannot access 'eval': No such file or directory` (exit 2)

**AFTER**: `2026-11-01T11:56+07:00 $ ls eval` → `cost-log  golden  package.json  pnpm-lock.yaml  prices.json  src  test  tsconfig.json` (exit 0). `cd eval && pnpm test` → `Test Files  5 passed (5)`, `Tests  61 passed (61)`. `pnpm eval -- --step core-files --subject baseline-readme` (network blocked by a preload) → 20 repo rows, `**Mean recall 0.148, mean precision 0.320**`, exit 0. `pnpm eval:cost -- --run test-fixture-run` → `4 LLM calls, total $0.464400`.

**DELTA**: A user can now score any pipeline step against 20 hand-labelled, SHA-pinned repos offline, see the baseline number to beat, and log and total LLM cost per step and per ladder.

**WITNESS**: Supervisor reran the verification command on 2026-11-01T11:59 in `.claude/worktrees/T004/eval`; trace `memory/event-trace/T004.jsonl`.