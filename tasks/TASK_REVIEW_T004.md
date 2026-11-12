# TASK_REVIEW — T004: Golden set of 20 hand-checked repos, eval harness, per-step cost logging

> Sibling of `tasks/TASK_GUIDE_T004.md`. Everything here is **filled by the reviewer at Stage
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
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☑ pass | New files: `eval/test/golden.test.ts` (AC 1, 2, 8), `eval/test/scorers.test.ts` (AC 4), `eval/test/cost.test.ts` (AC 6, 7), `eval/test/record.test.ts` (AC 3), `eval/test/harness.test.ts` (AC 4, 5, offline). Written before the implementation; first run with the fixtures not yet recorded: `59 pass / 13 fail` (all 13 in golden.test.ts and harness.test.ts, `ENOENT ... golden/fixtures/The-Pocket__PocketFlow.json`). After recording: `bun test` at 2026-11-12T08:20:12Z printed `74 pass`, `0 fail`, `537 expect() calls`, `Ran 74 tests across 5 files. [121.00ms]`. Written by the same agent that wrote the code, so the independence rule is not met: needs the Supervisor's independent run (see the verify row). |
| Verification command run | ☑ pass | Run at 2026-11-12T08:19:38Z in `eval/` with Bun 1.4.4 (the eval step's report body is cut here; its summary table is in the Demonstration AFTER). `(bun install --frozen-lockfile && bun test && bun run eval -- --step core-files --subject baseline-readme && bun run eval:cost -- --run test-fixture-run)` printed: `Checked 6 installs across 7 packages (no changes)`, `72 pass` `0 fail` `531 expect() calls` (74 after two tests were added later), `$ bun run src/cli-eval.ts --step core-files --subject baseline-readme` (wrote report JSON + MD, 20 rows), then `Cost for run test-fixture-run: 5 calls`, per step `mapper 2 calls 0.8100`, `generate-l1 2 calls 1.0380`, `blind-solver 1 call 0.1650`, per ladder `o/a 1.2330`, `o/b 0.7800`, `Total USD: 2.0130`; exit 0. Also `bun run typecheck` (`tsc --noEmit`) printed no errors. Offline proof: inside `unshare -rn` (no network; `curl https://api.github.com` gave `000`), `bun run eval -- --step core-files --subject baseline-readme` exited 0 and wrote both report files. |
| Negative cases hold | ☑ pass | Unit: unknown model throws `UnknownModelPriceError` and writes no line (also `constructor`, `__proto__`); negative, fractional and NaN tokens, empty or missing `step`, and `runId` `../evil` rejected with `InvalidCostEntryError`; a core path absent from the tree fails naming repo and path (`src/does/not/exist.ts`); `SRC/index.ts` fails (case-sensitive); a directory is not accepted; empty `predicted` gives `precision 0`, not NaN. CLI: `--subject ../cost` -> `invalid subject name`, exit 1; `--step bogus` -> usage, exit 2; `eval:cost --run no-such` -> `no cost log for run`, exit 1. Mutation check of the oracle (edit, run, restore): precision divided by expected -> 1 test failed (then added a different-list-size test); cached tokens priced as fresh input -> 1 failed; unknown model returns `usd: 0` -> 2 failed; case-insensitive path check -> 1 failed; after restore `74 pass`. |
| verify | ☐ pass / ☐ fail / ☐ N/A | Pending: the implementer cannot run `verify` and wrote the tests itself, so the Supervisor's headless auto verify must re-run them independently. |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | ☑ pass | Self-review only (the `code-review` skill is not available to this agent, so it was not run). Reviewed: all of `eval/src`, `eval/test`, `eval/golden/repos.json`. New files only under `eval/` plus this review file; no kit, memory, `experiments/` or main-checkout file touched. Not reviewed: the 20 fixture JSON bodies (data), `bun.lock`. |
| Full smoke suite still green (no regression) | ☑ pass | The project has no other code suite yet (T003 app scaffold runs in another worktree and was not touched). The only suite is `eval/`: `74 pass`, `0 fail`. |
| **Companion score (easy-verifier)** | ☑ N/A | [`overall` and `change_risk` as the tool returned them, the scope, the ref, and the absolute path of the verifier report after a literal `report:` label — e.g. "overall 86 (>= 80), change_risk pass, scope changes, ref `main...HEAD`, report: `/home/me/.easy-verifier-reports/kit/score_changes_20261028T0530Z.html`". The gate reads the path that follows `report:` and nothing else, so with no label, or a path that is absent, the row is unscored — write ☑ N/A instead. ☑ N/A with a reason when neither companion tool was run: the merge gate blocks on ☑ fail only, never on an absent or N/A row] N/A: neither companion tool is available to this agent; not run. |
| **UI: Visual regression (diff or verdict pasted)** | ☑ N/A | No UI in this task. |
| **UI: Design-system compliance (tokens/colors/typography verified)** | ☑ N/A | No UI in this task. |
| **UI: Responsiveness at target viewports** | ☑ N/A | No UI in this task. |

---

## Demonstration

> Anchors what this task delivered to an observable before/after pair. BEFORE has no `N/A` path:
> if the task changes executable code, BEFORE is a pasted, timestamped terminal capture taken
> **before any implementation commit exists**; if it does not (docs, templates, skill-instruction
> text), BEFORE is the **verbatim prior content** of what changed — a quoted excerpt, not a command.

**BEFORE**: captured 2026-11-12T08:04:57Z in `/home/thunderkds/workspace/pets/wt-t004` at commit `c4b20ab`
(before any T004 implementation commit; Bun 1.4.4 installed in a scratch dir because the host had no Bun).
The guide's verification command fails because `eval/` does not exist:

```
$ cd eval && bun install --frozen-lockfile && bun test && bun run eval -- --step core-files --subject baseline-readme && bun run eval:cost -- --run test-fixture-run
(eval):cd:1: no such file or directory: eval
exit=1
$ ls eval
ls: cannot access 'eval': No such file or directory
```

**AFTER**: captured 2026-11-12T08:19:38Z (verification command) in `/home/thunderkds/workspace/pets/wt-t004/eval`, Bun 1.4.4:

```
$ (bun install --frozen-lockfile && bun test && bun run eval -- --step core-files --subject baseline-readme && bun run eval:cost -- --run test-fixture-run)
bun install v1.4.4 (38afee6c8)
Checked 6 installs across 7 packages (no changes) [1.00ms]
bun test v1.4.4 (38afee6c8)
 72 pass
 0 fail
 531 expect() calls
Ran 72 tests across 5 files. [87.00ms]
$ bun run src/cli-eval.ts --step core-files --subject baseline-readme
$ bun run src/cli-cost.ts --run test-fixture-run
Cost for run test-fixture-run: 5 calls

Per step
| Key | Calls | Input tokens | Cached input | Output tokens | USD |
|---|---|---|---|---|---|
| mapper | 2 | 200000 | 0 | 14000 | 0.8100 |
| generate-l1 | 2 | 160000 | 110000 | 35000 | 1.0380 |
| blind-solver | 1 | 40000 | 0 | 3000 | 0.1650 |

Per ladder
| Key | Calls | Input tokens | Cached input | Output tokens | USD |
|---|---|---|---|---|---|
| o/a | 3 | 250000 | 60000 | 31000 | 1.2330 |
| o/b | 2 | 150000 | 50000 | 21000 | 0.7800 |

Total USD: 2.0130
```

(`74 pass` after two tests were added at 08:20; the eval run's stdout was sent to /dev/null here.) The baseline's Markdown summary from the earlier run at 2026-11-12T08:19:25Z (`bun run eval -- --step core-files --subject baseline-readme`, wrote `eval/reports/core-files-20261112T081925Z.{json,md}`; the Missed and Extra columns are cut here for length):

```
| Repo | Tier | Recall | Precision |
|---|---|---|---|
| The-Pocket/PocketFlow | trending | 0.14 | 0.11 |
| developit/mitt | trending | 0.33 | 0.50 |
| tj/commander.js | trending | 0.14 | 0.03 |
| honojs/hono | trending | 0.00 | 0.00 |
| BurntSushi/ripgrep | trending | 0.13 | 0.25 |
| pallets/click | trending | 0.00 | 0.00 |
| charmbracelet/bubbletea | trending | 0.00 | 0.00 |
| lukeed/dset | medium | 0.00 | 0.00 |
| sindresorhus/escape-string-regexp | medium | 0.00 | 0.00 |
| mattn/go-isatty | medium | 0.00 | 0.00 |
| lukeed/klona | medium | 0.00 | 0.00 |
| pallets/itsdangerous | medium | 0.00 | 0.00 |
| dtolnay/semver | medium | 0.14 | 1.00 |
| rs/xid | medium | 0.00 | 0.00 |
| sindresorhus/slash | lowkey | 0.00 | 0.00 |
| sindresorhus/is-plain-obj | lowkey | 0.00 | 0.00 |
| kballard/go-shellquote | lowkey | 0.00 | 0.00 |
| dtolnay/itoa | lowkey | 0.25 | 1.00 |
| kjd/idna | lowkey | 0.00 | 0.00 |
| raviqqe/hamt | lowkey | 0.14 | 1.00 |
| **mean** | | 0.06 | 0.19 |
```

The number T006 must beat: mean recall 0.06, mean precision 0.19 (concepts step with the topics baseline: mean overlap 0.01).

**DELTA**: Before, no golden set, scorer or cost log existed; now `bun run eval` scores any pipeline step against 20 pinned, hand-labelled repos offline (baseline mean recall 0.06), and `logStepCost` records a real USD cost per step for every later LLM step.

**WITNESS**: Run by the qa-expert agent that also wrote the code (2026-11-12T08:04Z BEFORE, 08:19-08:20Z AFTER), so this is not independent. The Supervisor's trace file `memory/event-trace/T004.jsonl` and the headless auto verify run are the independent witness.
