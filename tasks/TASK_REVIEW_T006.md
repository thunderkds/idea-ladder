# TASK_REVIEW — T006: Repo reader agent (3 read-only tools: list, read, search; step cap; token budget) picks core files; scored on golden set

> Sibling of `tasks/TASK_GUIDE_T006.md`. Everything here is **filled by the reviewer at Stage
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
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☑ pass (implementer; reviewer to confirm) | `tests/repo-reader.test.ts` (AC 1, 2, 3, 4, 6 usage, 8), `tests/pick-core-files.test.ts` (AC 5, AC 6), `tests/repo-reader-subject.test.ts` (AC 7 offline: report columns, baseline, verdicts), `tests/migrate.test.ts` § 0003_core_files (up/down/up, constraints), `tests/config.test.ts` (reader env). 2026-11-12T09:46:32Z: `bun test repo-reader pick-core-files` → ` 19 pass / 0 fail / Ran 19 tests across 3 files. [590.00ms]`; full `bun test` → ` 144 pass / 0 fail` |
| Verification command run | ☐ pass / ☑ fail (partial: paid step not run) | `bun install --frozen-lockfile` ok; `bun run typecheck && bun run lint` → `tsc --noEmit` clean, `Checked 50 files ... No fixes applied.`, `check-tokens: 0 color literals`; `bun test repo-reader pick-core-files` → 19 pass 0 fail. `cd eval && bun run eval -- --step core-files --subject repo-reader` → `eval failed: subject "repo-reader" not found in src/subjects/: repo-reader needs ANTHROPIC_API_KEY, MODEL_A_ID, GITHUB_TOKEN (paid run on model A)` — no key in the implementer's environment; NO golden-set scores exist yet (SC 6 / AC 7 paid run open, owner action below). Note: the guide runs `bun run eval` from the repo root; the `eval` script lives in `eval/package.json`, so run it from `eval/`. |
| Negative cases hold | ☑ pass | `read("../../etc/passwd")`, `read("/etc/passwd")`, `read("not-in-tree.ts")`, `src/../README.md`, `./README.md` → `error: path-not-in-tree`, readFile never called; binary/minified/LFS → `binary-file`/`minified-file`/`lfs-pointer`; list forever → 15 steps + 1 `toolChoice: none` call; invented paths dropped + logged, one repair, then `reader-invalid-output` (job failed, not retried); injection README + `write_file` call → tools stay `[list, read, search]`, output schema unchanged |
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

**BEFORE**: captured 2026-11-12T09:29:00Z on `3042e26` (worktree `T006-reader`, before any implementation commit):

```
$ bun test repo-reader pick-core-files
21 files were searched [2.00ms]

note: Tests need ".test", "_test_", ".spec" or "_spec_" in the filename (ex: "MyApp.test.ts")

$ cd eval && bun run eval -- --step core-files --subject repo-reader
$ bun run src/cli-eval.ts --step core-files --subject repo-reader
eval failed: subject "repo-reader" not found in src/subjects/: Cannot find module './subjects/repo-reader.ts' imported from /home/thunderkds/workspace/pets/wt-t006/eval/src/harness.ts
error: script "eval" exited with code 1
```

**AFTER**: captured 2026-11-12T09:46:32Z on `8ab6977` (implementer run; the paid golden-set run is still open):

```
$ bun test repo-reader pick-core-files
 19 pass
 0 fail
Ran 19 tests across 3 files. [590.00ms]

$ cd eval && bun run eval -- --step core-files --subject repo-reader
eval failed: subject "repo-reader" not found in src/subjects/: repo-reader needs ANTHROPIC_API_KEY, MODEL_A_ID, GITHUB_TOKEN (paid run on model A)
error: script "eval" exited with code 1
```

Owner action for the paid run (SC 6 / AC 7), not done by the implementer:
1. Add the real price of model A to `eval/prices.json` (key = the exact `MODEL_A_ID`, USD per 1M tokens: `input`, `output`, `cachedInput`, `source`, `checkedAt`). The subject and the server refuse to start without it.
2. `cd eval && ANTHROPIC_API_KEY=... MODEL_A_ID=claude-sonnet-5-5 GITHUB_TOKEN=<read-only public token> bun run eval -- --step core-files --subject repo-reader`
3. Paste the printed table (per-repo recall/precision, model calls, USD, hit limit; mean row; baseline mean recall; the three `Verdict` lines) here. File reads are live GitHub contents-API calls at each fixture's pinned SHA (no recorded file contents exist in the T004 fixtures).

**DELTA**: a started ladder job now runs a second step, `pick-core-files`, that stores 3–10 ranked core files with reasons for the repo + SHA, and the eval can score the reader against the golden set once model A is paid for.

**WITNESS**: [who ran it and when — derived from `memory/event-trace/Txxx.jsonl`, never the
implementing agent alone]
