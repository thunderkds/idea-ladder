# TASK_REVIEW — T008: Level generators in parallel from grounded chunks; answer-key code check; embedding dedupe; save ladder unverified

> Sibling of `tasks/TASK_GUIDE_T008.md`. Everything here is **filled by the reviewer at Stage
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
1. Requirement Fidelity Gate signed `auto (Supervisor)` before spawn: FR-003, FR-004, FR-005, FR-006, FR-016, NFR-005, NFR-006, US-001, US-003 all exist in PRD.md, and every AC traces to the Requirement — RULE: docs/claude-md/tracks.md:221 "| 13 | Stage 2/3: the Requirement Fidelity Gate (\"Restated intent confirmed\") | Signed `auto (Supervisor)`"
2. Chunks are ~1,500 chars with 200 overlap — FACT: tasks/TASK_GUIDE_T008.md:82 "splits README, `docs/**/*.md`, dependency files and T006 core files at the pinned SHA into chunks (~1,500 chars, 200 overlap"
3. The regeneration prompt includes the failure reason — FACT: tasks/TASK_GUIDE_T008.md:85 "Fail → that question is regenerated with the failure reason, at most 2 times"
4. Embedding model: OpenAI `text-embedding-3-small`, `vector(1536)`, through `@ai-sdk/openai` 3.0.x pinned (same `@ai-sdk/provider` 3.0.19 as `@ai-sdk/anthropic` 3.0.135); key `OPENAI_API_KEY`, model id from env; an `embedding_model` column next to the vector; an OpenAI chat model goes on T009's model B shortlist so one key may serve both — DEBATED: OpenAI text-embedding-3-small (Advocate 1: OpenAI text-embedding-3-small 1536 via @ai-sdk/openai, shortlist an OpenAI chat model for T009; Advocate 2: OpenAI text-embedding-3-small 1536 via @ai-sdk/openai, store embedding_model per chunk) ⚠ decided for you — please review
5. `OPENAI_API_KEY` is not on this machine: T008 is built and tested on a deterministic mock embedder that exists only in tests; the server's embedder fails fast naming `OPENAI_API_KEY` and never falls back to the mock; the paid golden-set run (SC 8) and the live `/start` are the owner's — DEBATED: build on the mock, live runs paused for the key (Advocate 1: option (b), build and test with the mock, Paused only for the 2 steps that need the key; Advocate 2: option (b), with fail-fast naming the key and a test-only mock) ⚠ decided for you — please review
6. The brainstorm decision is recorded in `docs/decisions/0006-generation.md`, not `0002-generation.md`, because 0002 is taken — FACT: docs/decisions/0002-ladder-levels-table.md:1 "# 0002 — `ladder_levels` table (T010, reused by T008)"
7. Spawn model claude-opus-5-5 (C3) — FACT: PROJECT_SPEC.md:80 "| claude | `claude` | haiku-5-5 | sonnet-5-5 | sonnet-5-5 or opus-5-5 | opus-5-5 |"
8. Built as subtasks 8a–8d by sequential agents, one commit per item — RULE: tasks/TASK_GUIDE_T008.md:153 "Decompose (C3) into subtasks, each with its own tests, landing in this order"
9. T008 writes the guide's AC 2 pass-test kinds; `src/shared/levels.ts` FIXED_LEVELS (T010's display default) is not changed — FACT: docs/decisions/0002-ladder-levels-table.md:15 "| `pass_test_kind` | `text` | free text kind of the pass test (T012 and T013 decide the values) |"
10. Stage 4 P2 fix set: fix (1) embedding batches by size and (2) the flaky test; cut (3) regenerations in one step, (4) RateLimitError in chunk-and-embed, (5) stale `mapped` jobs, (6) two pass-test kind names — DEBATED: fix 1 and 2, cut 3–6 (Advocate 1: fix 1 and 2, cut 3, 4, 5, 6; Advocate 2: fix 1, 2 and 4, cut 3, 5, 6) ⚠ decided for you — please review
11. 6 P3 findings go on the cut list (unanchored LEVEL_STEP regex; drop reason after failed regenerations; quadratic lineAt; FAILED_DETAIL text; migrate test title; per-row INSERTs) — RULE: .claude/skills/code-review/SKILL.md:142 "Do not apply P2/P3 fixes automatically — present them as suggestions only."
Paused: the paid golden-set run (SC 8) and the live `/start` wait for `OPENAI_API_KEY` and a `text-embedding-3-small` entry in eval/prices.json with a real `checkedAt` — a login or secret the Supervisor does not have (docs/claude-md/tracks.md `### Stops that stay`); before that live `/start`, mark any job left in `mapped` from T007 runs `failed` (cut-list item 5)
Checks: tests `bun test` — 443 pass / 0 fail (3 consecutive runs by the fix agent, 1 by the Supervisor on 6ca472b); `bun test --rerun-each 10 <8 T008 files>` — 950 pass / 0 fail; `bun test chunk-and-embed level-generator answer-key-check dedupe save-ladder` — 72 pass / 0 fail; `bun test migrate` — 27 pass; `cd eval && bun test` — 77 pass; `bun run test:e2e -- start-flow` — 6 passed; typecheck and lint clean; reviews code-review — 0 P0, 0 P1, 2 of 6 P2 fixed, 4 P2 + 6 P3 on the cut list (reports/code-review_T008-level-generators_20261119T100000.html); security-review — no findings; migration-safety (0008, 0009) — GO; real run `cd eval && bun run eval -- --step ladder --subject level-generators` — printed `eval failed: subject "level-generators" not found in src/subjects/: level-generators needs OPENAI_API_KEY, GITHUB_TOKEN (paid run); no model call was made` (auto-checked, not /verify)
Memory: memory/learnings.md — @inngest/test leaks parallel-step executions after a run (drain with tests/support/inngest-drain.ts); AI SDK embedMany splits by count only, batch by size
Not done: golden-set run SC 8 and live `/start` (owner, paid, needs OPENAI_API_KEY + the embedding price entry); issue titles for L2/L4 (the snapshot stores counts only; the generators get counts); auto verify: running (T182); merge (admin: after the auto verify pass)

## Evidence

| Check | Result | Notes / output snippet |
|-------|--------|------------------------|
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☑ pass | AC 1, SC 1: tests/chunk-and-embed.test.ts; AC 2–3, SC 3, SC 6–7: tests/level-generator.test.ts, tests/level-generator-step.test.ts; AC 4, SC 2: tests/answer-key-check.test.ts, tests/level-generator-regenerate.test.ts; AC 5, SC 4: tests/dedupe.test.ts, tests/check-and-dedupe.test.ts; AC 6, SC 5: tests/verbatim-check.test.ts; AC 7–8, SC 6–7 end to end: tests/save-ladder.test.ts; migrations 0008/0009: tests/migrate.test.ts; SC 8 subject: tests/level-generators-subject.test.ts. `bun test chunk-and-embed level-generator answer-key-check dedupe save-ladder` → 72 pass / 0 fail (2026-11-19T09:56:25Z) |
| Verification command run | ☑ pass | On 6ca472b: `bun run typecheck && bun run lint` → "Checked 120 files in 70ms. No fixes applied." / "check-tokens: 0 color literals outside src/client/tokens.css"; `bun test` → 443 pass / 0 fail; guide test command → 72 pass / 0 fail. `bun run eval -- --step ladder --subject level-generators` NOT run: paid, needs OPENAI_API_KEY (Auto decision 5); with no credentials it fails fast naming the keys |
| Negative cases hold | ☑ pass | Red before green per subtask (e.g. 8a step test failing before the step existed; embed batching 'Expected: > 1 Received: 1' before d779933). Drops asserted: bad-citation, bad-options, key-check-failed after exactly 3 model calls (SC 2), verbatim-copy (SC 5), duplicate (SC 4); failure reasons generate-level-Ln-failed, check-and-dedupe-failed, save-ladder-failed with no ladder row (AC 8); embedder-not-configured with no mock fallback |
| verify | ☐ pass / ☐ fail / ☐ N/A | [what was observed — must literally state "pass" or "fail" here too, e.g. "skill run, feature confirmed working — pass": the merge gate scans this Notes column for the word "pass", not just the Result column] |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | ☑ pass | `git diff main...HEAD` (47 files) plus direct callers, split between two independent reviewers (pipeline core; persistence, client, eval) and one security reviewer; kit files and untouched modules skipped |
| Full smoke suite still green (no regression) | ☑ pass | `bun test` 443 pass / 0 fail (main baseline 359); eval suite 77 pass; e2e start-flow 6 passed. The 2 pre-existing T015 pwa e2e failures (e2e/pwa.e2e.ts:584, :743) fail on main too (T007 Auto decision 11) and were not rerun |
| **Companion score (easy-verifier)** | ☑ N/A | Neither companion tool was run for this task |
| **UI: Visual regression (diff or verdict pasted)** | ☑ N/A | No new screen and no UI section in the guide: the only client change is the job status page's final status `done` with an `Open your ladder` link (src/client/App.tsx), asserted by e2e/start-flow.e2e.ts (6 passed) |
| **UI: Design-system compliance (tokens/colors/typography verified)** | ☑ N/A | Same: the link reuses the existing `.button` class; `check-tokens: 0 color literals outside src/client/tokens.css` |
| **UI: Responsiveness at target viewports** | ☑ N/A | Same: no layout change; start-flow e2e keeps its existing 360 px no-horizontal-scroll check |

---

## Demonstration

> Anchors what this task delivered to an observable before/after pair. BEFORE has no `N/A` path:
> if the task changes executable code, BEFORE is a pasted, timestamped terminal capture taken
> **before any implementation commit exists**; if it does not (docs, templates, skill-instruction
> text), BEFORE is the **verbatim prior content** of what changed — a quoted excerpt, not a command.

**BEFORE** (captured by backend-developer, subtask 8a, before any implementation commit):

```
$ date -u +%Y-%m-%dT%H:%M:%SZ; bun test chunk-and-embed level-generator answer-key-check dedupe save-ladder; ls migrations | grep 0008 || echo "no 0008 migration"
2026-11-19T08:43:14Z
bun test v1.4.4 (38afee6c8)
The following filters did not match any test files in --cwd="/home/thunderkds/workspace/pets/hungnguyen111/wt-t008":
 chunk-and-embed level-generator answer-key-check dedupe save-ladder
44 files were searched [2.00ms]

note: Tests need ".test", "_test_", ".spec" or "_spec_" in the filename (ex: "MyApp.test.ts")

no 0008 migration
```

**AFTER** (same test filter, on 6ca472b):

```
2026-11-19T09:56:25Z
 72 pass
 0 fail
 358 expect() calls
Ran 72 tests across 9 files. [5.97s]
0008_generation.down.sql
0008_generation.up.sql
0009_ladder_content.down.sql
0009_ladder_content.up.sql
```

**DELTA**: A repo job now ends `done` with a saved `unverified` ladder L0–L4 — grounded cards and MCQ pools whose keys pass the answer-key check, near-duplicates and verbatim copies removed, a generation report per level — and the status page links to it (live run waits for OPENAI_API_KEY).

**WITNESS**: Supervisor session 98505c1f-ee35-4589-bb57-774f30f8b789 ran the AFTER command at 2026-11-19T09:56:25Z (trace: memory/event-trace/T008.jsonl); BEFORE by agent 8a at 2026-11-19T08:43:14Z, commit b20f102.
