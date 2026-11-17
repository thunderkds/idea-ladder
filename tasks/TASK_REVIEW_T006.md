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
5. The 2026-11-17T03:42:50Z golden-set run (20/20 `reader-failed`, 0 tokens, recall 0.00) is an invalid run, not a threshold verdict: the child `claude` ran without the owner's `CLAUDE_CONFIG_DIR` and was not logged in (Supervisor probe printed `"is_error": true, "subtype": "success", "result": "Not logged in · Please run /login"`); fixed the hidden message in bdeda6f; the run is redone with `CLAUDE_CONFIG_DIR` set — FACT: eval/reports/core-files-20261117T034250Z.md:8 "reader-failed: claude reported an error (success)"
Paused: the valid golden-set run (AC 7) — the owner re-runs it in their terminal with `CLAUDE_CONFIG_DIR=/home/thunderkds/.claude-hung2`; the Supervisor's own run with the owner's `gh` token was denied by the permission classifier on 2026-11-17
Checks: tests `<command>` — <result>; reviews <skill — result>; real run `<command>` — printed `<what it printed>` (auto-checked, not /verify)
Memory: <each entry the memory pass wrote, as `file — entry` | nothing new>; memory/learnings.md — Gotchas: eval outside the session needs CLAUDE_CONFIG_DIR
Not done: merge (yours); <auto verify: running (T182) | auto verify: <result> | /verify (yours)>

-->

## Evidence

| Check | Result | Notes / output snippet |
|-------|--------|------------------------|
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☑ pass (implementer; reviewer to confirm) | `tests/repo-reader.test.ts` (AC 1, 2, 3, 4, 6 usage, 8; fix batch: output cap + no parallel tool calls on every call, budget refusal of final and repair calls (`reader-budget-exhausted`), `hitLimit` on `ReaderInvalidOutputError`, whitespace reason → repair → `reader-invalid-output`, usage-logger error not swallowed, 12-blob tree cut to 10, `</repo-search>` / `</REPO-FILE>` / `</repo-file >` escaped, a path with `"`, `>` and a newline JSON-encoded, paths > 300 chars hidden), `tests/pick-core-files.test.ts` (AC 5, AC 6; fix batch: cache write failure not fatal, 400 `APICallError` → `reader-error` with 1 model call, 4 failed attempts from `picking` → `onFailure` → `failed` / `reader-error`, picks stored by another writer mid-run are kept, never mixed), `tests/github-read-file.test.ts` (NUL at byte 15,000 → binary; stream stops at 1 MB), `tests/repo-reader-subject.test.ts` (AC 7 offline; fix batch: cap hit + `reader-invalid-output` → row `hitLimit: true`, `hitLimitRuns` 1; `readerLimitsFromEnv` refuses `abc`, `0`, `-1`, `1.5`, `51`, `500001`), `tests/migrate.test.ts` § 0003 (cache content CHECK ≤ 1,048,576 chars), `tests/config.test.ts` (upper bounds 50 / 500000). 2026-11-12T10:06:14Z on `2f67e51`: `bun test repo-reader pick-core-files github-read-file` → ` 36 pass / 0 fail / Ran 36 tests across 4 files. [704.00ms]`; full `bun test` → ` 161 pass / 0 fail / Ran 161 tests across 13 files.` The 11 new reader tests fail on the pre-fix `repo-reader.ts` (` 9 pass / 11 fail`). |
| Verification command run | ☐ pass / ☑ fail (partial: paid step not run) | 2026-11-12T10:06:14Z on `2f67e51`: `bun install --frozen-lockfile` → `Checked 372 installs across 329 packages (no changes)`; `bun run typecheck` → `tsc --noEmit` clean; `bun run lint` → `Checked 51 files in 26ms. No fixes applied.`, `check-tokens: 0 color literals outside src/client/tokens.css`; `bun test repo-reader pick-core-files github-read-file` → 36 pass 0 fail. `cd eval && bun run eval -- --step core-files --subject repo-reader` NOT run: it needs ANTHROPIC_API_KEY, MODEL_A_ID with a real price in `eval/prices.json`, and GITHUB_TOKEN (owner action below); NO golden-set scores exist yet. Note: the guide runs `bun run eval` from the repo root; the `eval` script lives in `eval/package.json`, so run it from `eval/`. |
| Negative cases hold | ☑ pass | `read("../../etc/passwd")`, `read("/etc/passwd")`, `read("not-in-tree.ts")`, `src/../README.md`, `./README.md` → `error: path-not-in-tree`, readFile never called; binary/minified/LFS → `binary-file`/`minified-file`/`lfs-pointer`; list forever → 15 steps + 1 `toolChoice: none` call; invented paths dropped + logged, one repair, then `reader-invalid-output` (job failed, not retried); injection README + `write_file` call → tools stay `[list, read, search]`, output schema unchanged; fix batch: final/repair call with no budget room → `reader-budget-exhausted`, call not made; late NUL → `binary-file`; 400 prompt too long → job `failed` / `reader-error`, not retried; repo text cannot close `<repo-file>` / `<repo-search>` / `<repo-list>` (every `<` → `&lt;`) |
| verify | ☑ fail | auto-run by hook, session 0b9ccf40-1cf7-416b-8ab0-1c17d8c6a8c2, commit e8480b56562f22a9226721d77b8dec7d1f29a9d1, log .claude/verify-runs/T006-e8480b56562f.log — fail |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | ☐ pass / ☐ fail | [what was reviewed vs. skipped, and why] |
| Full smoke suite still green (no regression) | ☑ pass (implementer; reviewer to confirm) | `bun run ci:local` started 2026-11-12T10:02:58Z on `2f67e51`: install, typecheck, lint, unit tests (` 161 pass` / ` 0 fail`), migrate up / down / up again, e2e sign-in `3 passed (2.3m)`, e2e start-flow `6 passed (34.5s)` → `ci:local: all steps passed`, `exit=0`. |
| **Companion score (easy-verifier)** | ☐ pass / ☐ fail / ☐ N/A | [`overall` and `change_risk` as the tool returned them, the scope, the ref, and the absolute path of the verifier report after a literal `report:` label — e.g. "overall 86 (>= 80), change_risk pass, scope changes, ref `main...HEAD`, report: `/home/me/.easy-verifier-reports/kit/score_changes_20261028T0530Z.html`". The gate reads the path that follows `report:` and nothing else, so with no label, or a path that is absent, the row is unscored — write ☑ N/A instead. ☑ N/A with a reason when neither companion tool was run: the merge gate blocks on ☑ fail only, never on an absent or N/A row] |
| **UI: Visual regression (diff or verdict pasted)** | ☑ pass | The only UI change is status text (`fetched`/`picking` → "Picking core files", `picked` → "Done"). `e2e/start-flow.e2e.ts` SC 7 now waits for heading `Picking core files` (job at `picking`, e2e reader slowed 3 s per model call in `e2e/serve.ts`), asserts its detail `This page updates by itself.`, then `Done` with `The repo is read and its core files are picked.`; passed in the ci:local run above. Baseline screenshots committed: `e2e/baseline/job-picking-mobile.png` (360×740), `e2e/baseline/job-picking-tablet.png` (768×1024), `e2e/baseline/job-picking-desktop.png` (1280×800). Verdict on viewing them: heading, repo name, muted detail and link render in the same layout as the existing status pages; no clipping or overlap. |
| **UI: Design-system compliance (tokens/colors/typography verified)** | ☑ pass | `expectTokens(page, STATUS_TOKENS)` runs on the `Picking core files` page (body bg `--color-bg`; h1 color/font-family/font-size/font-weight tokens; `.status-detail` color + font-size tokens; main padding + max-width tokens) — passed in the ci:local e2e start-flow run (`6 passed (34.5s)`). `bun run lint` → `check-tokens: 0 color literals outside src/client/tokens.css`. No CSS changed in T006. |
| **UI: Responsiveness at target viewports** | ☑ pass | `shootAll(page, "job-picking")` sets 360, 768 and 1280 px and asserts `document.documentElement.scrollWidth <= viewport width` at each — passed in the ci:local e2e start-flow run. No horizontal overflow found. |

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

**BEFORE (AC 7 rate-limit slice)**: captured 2026-11-17T03:24:28Z on `72a0e3c` plus the uncommitted red tests (worktree `T006-reader`, before any src change):

```
$ bun test claude-code-reader reader-mcp
(fail) pickCoreFilesClaudeCode (fake claude) > github-rate-limited tool errors are counted on the result, across the repair run; 0 when none [15.64ms]
  (received result has no githubRateLimited field; toMatchObject at tests/claude-code-reader.test.ts:305)
(fail) reader MCP server (claude-code back end) > a rate-limited GitHub read is a github-rate-limited tool error and one line in READER_RATE_LIMITED_FILE [91.05ms]
  ENOENT: no such file or directory, open '/tmp/il-mcp-rl-jnBtLk/rate-limited'
 27 pass
 2 fail
 138 expect() calls
Ran 29 tests across 2 files. [1.91s]
```

**BEFORE (AC 9 error-text slice)**: captured 2026-11-17T03:46:31Z on `904f50b` plus the uncommitted red tests (worktree `T006-reader`, before any src change):

```
$ bun test claude-code-reader
(fail) pickCoreFilesClaudeCode (fake claude) > is_error carries the CLI's result text (a Not logged in run is not a reader miss) [15.53ms]
  Expected to contain: "Not logged in · Please run /login"
  Received: "reader-failed: claude reported an error (success)"
(fail) pickCoreFilesClaudeCode (fake claude) > is_error result text is one line, cut to 200 chars [14.32ms]
  Received: "ader-failed: claude reported an error (success)"
 16 pass
 2 fail
Ran 18 tests across 1 file. [986.00ms]
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

## Auto decisions

Mode: auto
1. Count `github-rate-limited` reads per run and per repo in the AC 7 report (guide amended on main, 22dabd3) before any agent coded it — FACT: memory/decisions.md:76 "user answer 2026-11-17"; rule source CLAUDE.md:205
2. Keep and finish the 2026-11-12 session's uncommitted red tests (`tests/claude-code-reader.test.ts`, `tests/reader-mcp.test.ts`, `tests/support/fake-claude.ts`), never discard them — FACT: memory/decisions.md:76 "user answer 2026-11-17" (was flagged for review; the user reviewed and accepted it)
3. The golden-set run (AC 7) uses the `claude-code` back end on the owner's subscription, no API key — FACT: memory/decisions.md:76 "user answer 2026-11-17"; the run itself waits for the user's go-ahead (see Paused)
4. T007 guide aligned with T006 as built (migration 0007, `mapping`/`mapped` status, `model-a.ts`, `usd: null` on claude-code), main d4a0300 — RULE: Supervisor owns guides; read-only check by an Explore agent, findings spot-checked against `migrations/` and `src/server/app.ts:61`
5. The 2026-11-17T03:42:50Z golden-set run (20/20 `reader-failed`, 0 tokens, recall 0.00) is an invalid run, not a threshold verdict: the child `claude` ran without the owner's `CLAUDE_CONFIG_DIR` and was not logged in (Supervisor probe printed `"is_error": true, "subtype": "success", "result": "Not logged in · Please run /login"`); fixed the hidden message in bdeda6f; the run is redone with `CLAUDE_CONFIG_DIR` set — FACT: eval/reports/core-files-20261117T034250Z.md:8 "reader-failed: claude reported an error (success)"
Paused: the valid golden-set run (AC 7) — the owner re-runs it in their terminal with `CLAUDE_CONFIG_DIR=/home/thunderkds/.claude-hung2`; the Supervisor's own run with the owner's `gh` token was denied by the permission classifier on 2026-11-17
Checks: tests `bun run typecheck && bun run lint && bun test` — 310 pass / 0 fail, eval 77 pass / 0 fail on bdeda6f (re-run by the Supervisor); reviews code-review + security-review on 72a0e3c (main ea107f1) — no P0; real run `bun run eval -- --step core-files --subject repo-reader` — first run 2026-11-17T03:42:50Z invalid (Not logged in, decision 5); valid run pending
Memory: memory/decisions.md — 2026-11-17 T006 auto decisions 1–3 accepted by the user; memory/MEMORY.md — index line for it; memory/learnings.md — Gotchas: eval outside the session needs CLAUDE_CONFIG_DIR
Not done: golden-set run (AC 7); auto verify; merge and push (allowed under [admin] only after the auto verify passes)
