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
Paused: auto-mode check failed — no test run in memory/event-trace/T008.jsonl — write /home/thunderkds/workspace/pets/hungnguyen111/idea-ladder/.claude/hooks/.state/active_task.d/$CLAUDE_CODE_SESSION_ID with the task ID (minimal-track step 1): `mkdir -p /home/thunderkds/workspace/pets/hungnguyen111/idea-ladder/.claude/hooks/.state/active_task.d && printf '%s\n%s\n' "T008" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > /home/thunderkds/workspace/pets/hungnguyen111/idea-ladder/.claude/hooks/.state/active_task.d/$CLAUDE_CODE_SESSION_ID`, then rerun the task's tests so the trace records them under the task, then stop; extended track, but the trace has no `code-review` Skill call (Stage 4 runs in auto mode); Risk Medium, but the trace has no `security-review` Skill call

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
Paused: the paid golden-set run (SC 8) and the live `/start` wait for `OPENAI_API_KEY` — a login or secret the Supervisor does not have (docs/claude-md/tracks.md `### Stops that stay`)
Checks: tests — not yet run; reviews — not yet run; real run — not yet run
Memory: nothing new
Not done: golden-set run SC 8 and live `/start` (owner, paid, needs OPENAI_API_KEY); auto verify: not started; merge (admin: after the auto verify pass)

## Evidence

| Check | Result | Notes / output snippet |
|-------|--------|------------------------|
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☐ pass / ☐ fail | [test file path(s) — required before Done] |
| Verification command run | ☐ pass / ☐ fail | [paste actual output] |
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

**AFTER**: [same command, post-change] OR [verbatim excerpt of the new content]

**DELTA**: [one sentence — what a user can now do that they could not before]

**WITNESS**: [who ran it and when — derived from `memory/event-trace/Txxx.jsonl`, never the
implementing agent alone]
