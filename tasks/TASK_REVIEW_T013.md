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

## Auto decisions

Mode: auto
1. Requirement Fidelity Gate signed `auto (Supervisor)` before spawn — RULE: docs/claude-md/tracks.md:221 "| 13 | Stage 2/3: the Requirement Fidelity Gate ("Restated intent confirmed") | Signed `auto (Supervisor)`"
2. L1 passes through the T012 MCQ pass test on README/setup chunks (option B); a run log and a 3-sentence explanation are optional feedback, never scored, never in evidence; no option A nonce or gist verifier — DEBATED: option B (Advocate 1: option B, MCQs on setup with log/explanation as feedback; Advocate 2: option A, a gist with a nonce checked on GitHub; Advocate 3: option B, the smallest change) ⚠ decided for you — please review (the guide's earlier Supervisor recommendation was A; this was the guide's one user decision)
3. Migration numbered 0014, because T016 owns 0013 — FACT: tasks/TASK_GUIDE_T013.md:165 "| new migration `0014_artifacts` (0013 is T016's) |"
4. Spawn model claude-opus-5-5 (C2, Risk High) — FACT: PROJECT_SPEC.md:80 "| claude | `claude` | haiku-5-5 | sonnet-5-5 | sonnet-5-5 or opus-5-5 | opus-5-5 |"
5. A repo link that is a fork of the ladder repo is rejected `not-from-scratch` — FACT: tasks/TASK_GUIDE_T013.md:153 "a repo link that is a fork of the ladder repo → `not-from-scratch`"
6. Stage 4 fix set: the P1 (old ladders and thin READMEs leave L1 at `pool-too-small`) is resolved as specified — no runtime bypass, local/test DBs reset, the thin-README result is AC 6's own test row, and follow-up T033 handles thin pools at generation for L0/L1/L3; fix the e2e seed kind now (7052dae); cut the 4 P2s (old L1 text on old rows; upstream merges in an L2 branch; L4 repo copy with one commit; L4 PR commits not checked) and the other 5 P3s — DEBATED: no bypass, seed fix only, T033 follow-up (Advocate 1: no bypass, dev-data reset, T033 follow-up, fix seed + URL normalisation + second L4 row + secondary rate limit; Advocate 2: no bypass, concept-only fallback for a thin L1 now, fix seed and 4 P3s; Advocate 3: no bypass, dev-data reset, fix the seed only, T033 follow-up) ⚠ decided for you — please review
7. Lane check EXCEEDS (26 files > 14; 1912 lines > 500) accepted: most of it is new tests and GitHub fixtures — RULE: .claude/skills/code-review/SKILL.md:74 "It is warn-only"
Checks: tests `bun test --timeout 60000` — 593 pass / 0 fail (build agent); `bun test -t T013` — 64 pass / 0 fail (Supervisor, 7052dae); `bun run test:e2e -- e2e/ladder-view.e2e.ts` — 8 passed; typecheck and lint clean; reviews code-review — 0 P0, 1 P1 resolved as specified (Debate), 4 P2 cut, 1 P3 fixed (7052dae), 5 P3 cut; security-review — no findings (confidence ≥ 8); migration-safety (0014) — GO (additive: artifacts, run_feedback); real run `bun test tests/artifact-routes.test.ts` — both routes through the app's HTTP handler against recorded GitHub responses: L2 pass + event, L4 pass + evidence, rejections with reason codes, 503 on rate limit (auto-checked, not /verify)
Memory: memory/decisions.md — T013 merged entry (written at merge)
Not done: a live check against real GitHub with the owner's GITHUB_APP_TOKEN and a real fork branch / merged PR (owner); T033 (thin MCQ pools); the L2 diff questions (T014); auto verify: running (T182); merge (admin: after the auto verify pass)

## Evidence

| Check | Result | Notes / output snippet |
|-------|--------|------------------------|
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☑ pass | Filled by backend-developer (implementer; reviewer to confirm). AC 1, 2, 4, 5: `tests/verify-l2-branch.test.ts`; AC 3, 4, 5: `tests/verify-l4-artifact.test.ts`; AC 5: `tests/github-artifacts.test.ts`, `tests/artifact-routes.test.ts`; AC 6: `tests/l1-run-mcq.test.ts`, `tests/artifact-routes.test.ts` (run-feedback); AC 7: `tests/artifacts-no-llm.test.ts`; Success Criterion 7: `tests/artifact-url.test.ts`; migration 0014: `tests/artifacts-migration.test.ts`, `tests/migrate.test.ts`. Full suite `bun test --timeout 60000`: ` 593 pass` / ` 0 fail` / ` 3336 expect() calls` / `Ran 593 tests across 59 files. [72.19s]` |
| Verification command run | ☑ pass | `bun install --frozen-lockfile && bun run typecheck && bun run lint && bun test -t "T013"` at 2026-11-19T11:42:30Z: `Checked 388 installs across 345 packages (no changes) [6.00ms]` / `$ tsc --noEmit` / `Checked 146 files in 77ms. No fixes applied.` / `check-tokens: 0 color literals outside src/client/tokens.css` / ` 64 pass` / ` 529 filtered out` / ` 0 fail` / ` 255 expect() calls` / `Ran 64 tests across 59 files. [7.76s]` |
| Negative cases hold | ☑ pass | author-mismatch (other account with the same email; null author; PR by another account; repo by another account); pr-not-merged (open, closed-unmerged); not-found (missing/private repo, branch, PR, unknown pinned SHA); no-new-commits; range-too-large (> 250); not-from-scratch; wrong-repo; 403/429 with remaining 0 → 503 retryAt, nothing stored; a client-sent token is ignored (app token only); locked level → 404 before any fetch; fetch and spawn made to throw → verifiers still complete (no LLM); L1 thin pool → insufficient-pool / pool-too-small |
| verify | ☐ pass / ☐ fail / ☐ N/A | [what was observed — must literally state "pass" or "fail" here too, e.g. "skill run, feature confirmed working — pass": the merge gate scans this Notes column for the word "pass", not just the Result column] |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | ☑ pass | `git diff main...HEAD` (26 files) plus direct callers (evidence.ts, mcq-test.ts, ladder-view.ts, the lock state); two independent reviewers (verifier trust path; L1 change and migration) and one security reviewer |
| Full smoke suite still green (no regression) | ☑ pass | `bun test --timeout 60000` 593 pass / 0 fail; e2e ladder-view 8 passed |
| **Companion score (easy-verifier)** | ☑ N/A | Neither companion tool was run for this task |
| **UI: Visual regression (diff or verdict pasted)** | ☑ N/A | Backend task: no UI section in the guide, no src/client file changed (the screens are T030) |
| **UI: Design-system compliance (tokens/colors/typography verified)** | ☑ N/A | Backend task: no UI section in the guide, no src/client file changed (the screens are T030) |
| **UI: Responsiveness at target viewports** | ☑ N/A | Backend task: no UI section in the guide, no src/client file changed (the screens are T030) |

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
