# TASK_REVIEW — T031: Remove embeddings: drop the embedder, `chunks.embedding` and `@ai-sdk/openai`; dedupe by word overlap

> Sibling of `tasks/TASK_GUIDE_T031.md`. Everything here is **filled by the reviewer at Stage
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
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☑ pass | tests/migrate.test.ts (AC 1: up/down/up with a seeded chunk row), tests/chunk.test.ts (AC 2: step `chunk`, no OPENAI_API_KEY, re-run adds 0 rows), tests/dedupe.test.ts + tests/check-and-dedupe.test.ts (AC 3), tests/config.test.ts (DEDUPE_JACCARD, DEDUPE_COSINE refused), tests/save-ladder.test.ts + tests/level-generator-step.test.ts (SC 4: ladder saved unverified, job done, no embedder), tests/level-generators-subject.test.ts (AC 5), tests/repo-config.test.ts (.env.example). `bun test`: 444 pass, 0 fail. |
| Verification command run | ☑ pass | 2026-11-19T10:26:50Z. `bun run typecheck`: no error. `bun run lint`: `Checked 118 files ... No fixes applied.` / `check-tokens: 0 color literals`. `bun test migrate chunk dedupe check-and-dedupe save-ladder level-generator config`: 109 pass, 0 fail. `bun test`: 444 pass, 0 fail, Ran 444 tests across 40 files. `cd eval && bun test`: 77 pass, 0 fail. `bun run test:e2e -- start-flow`: 6 passed. AC 4 grep (`openai|embedd?ing|embedder|cosine`): only the DEDUPE_COSINE refusal (config.ts + its test), the "no OPENAI_API_KEY" test, migrate/chunk tests that assert the columns are gone, and the concept name "Embeddings" in e2e/test data. `bun run db:migrate` was not run (no DATABASE_URL here); migrations are applied to a scratch DB by tests/migrate.test.ts. |
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

**BEFORE**:
```
2026-11-19T10:18:26Z
src/server/config.ts
src/server/embedder.ts
src/server/main.ts
eval/src/level-generators-subject.ts
src/server/ladder-generate.ts
e2e/serve.ts
src/server/check-and-dedupe.ts
eval/src/subjects/level-generators.ts
package.json
no 0010 migration
 13 pass
 0 fail
 32 expect() calls
Ran 13 tests across 2 files. [51.00ms]
```

**AFTER**:
```
2026-11-19T10:26:50Z
(grep -rlniE "openai|embedder" src eval/src e2e package.json -> no file)
0010_drop_chunk_embeddings.down.sql
0010_drop_chunk_embeddings.up.sql
bun test dedupe: 17 pass, 0 fail (word-overlap Jaccard tests)
eval, no GITHUB_TOKEN: level-generators needs GITHUB_TOKEN; no model call was made
```

**DELTA**: [one sentence — what a user can now do that they could not before]

**WITNESS**: [who ran it and when — derived from `memory/event-trace/Txxx.jsonl`, never the
implementing agent alone]
