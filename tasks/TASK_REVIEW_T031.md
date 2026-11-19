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

## Auto decisions

Mode: auto
1. Requirement Fidelity Gate signed `auto (Supervisor)` before spawn — RULE: docs/claude-md/tracks.md:221 "| 13 | Stage 2/3: the Requirement Fidelity Gate (\"Restated intent confirmed\") | Signed `auto (Supervisor)`"
2. Dedupe = Jaccard on raw word sets from the shared `words()` tokeniser, MCQ question + card front only, `DEDUPE_JACCARD` default 0.8, a leftover `DEDUPE_COSINE` refused by name — DEBATED: Jaccard on raw words at 0.8 (Advocate 1: Jaccard on content words with stop-word removal and plural fold, cutoff 0.7; Advocate 2: Jaccard on raw word sets, cutoff 0.8) ⚠ decided for you — please review
3. Step `chunk-and-embed` renamed `chunk`; migration 0010 drops the two columns and keeps the `vector` extension — RULE: tasks/TASK_GUIDE_T031.md:71 "| 1 | New migration `0010_drop_chunk_embeddings` drops `chunks.embedding` and `chunks.embedding_model`"
4. Spawn model claude-sonnet-5-5 (C2, Risk Medium) — FACT: PROJECT_SPEC.md:80 "| claude | `claude` | haiku-5-5 | sonnet-5-5 | sonnet-5-5 or opus-5-5 | opus-5-5 |"
5. The chunk step's onFailure reason after retries is `chunk-failed` (replaces `embedder-error`) — FACT: src/server/ladder-generate.ts:529 "? \"chunk-failed\"" (same `<step>-failed` pattern as `generate-level-Ln-failed`, tasks/TASK_GUIDE_T008.md:89)
6. Stage 4 fix set: fix P2-a (migrate scratch filter `f < "0010"`, path from import.meta.dir), P2-b (`chunk-failed` onFailure test), P2-c (no env assertion); cut P3-a (down CHECK), P3-b (test title), P3-c (comment typos) — DEBATED: fix the 3 P2s, cut the 3 P3s (Advocate 1: fix P2-a, P2-b, P2-c, cut P3s; Advocate 2: fix P2-a, P2-c, P2-b, cut P3s) ⚠ decided for you — please review
7. Lane check EXCEEDS (29 files > 14; 843 lines > 500) is accepted: most files are tests touched by the removal — RULE: .claude/skills/code-review/SKILL.md:74 "It is warn-only"
Checks: tests `bun test` — 445 pass / 0 fail (fix agent, f3aff3e); `bun test migrate chunk dedupe check-and-dedupe` — 50 pass / 0 fail (Supervisor, f3aff3e); `cd eval && bun test` — 77 pass; `bun run test:e2e -- start-flow` — 6 passed; typecheck and lint clean; reviews code-review — 0 P0, 0 P1, 3 P2 fixed (f3aff3e), 3 P3 cut; security-review — no findings (confidence ≥ 8); migration-safety (0010) — GO; real run `cd eval && env -u GITHUB_TOKEN bun run eval -- --step ladder --subject level-generators` — printed `eval failed: subject "level-generators" not found in src/subjects/: level-generators needs GITHUB_TOKEN; no model call was made` (auto-checked, not /verify)
Memory: memory/decisions.md — T031 merged entry (written at merge)
Not done: golden-set run SC 8 of T008 and a live `/start` (owner: needs GITHUB_TOKEN and the Claude login, no OPENAI_API_KEY any more); auto verify: ☑ pass (session 73d99fb0-c0a2-4a9c-890d-cf93cea6e55c, commit 2e2108ec4a024bb76bd972708ae11f9363f8080a, log .claude/verify-runs/T031-2e2108ec4a02.log); merge (admin: after the auto verify pass)
Closed: row moved to Done 2026-11-19 — auto verify pass (session 73d99fb0-c0a2-4a9c-890d-cf93cea6e55c, commit 2e2108ec4a024bb76bd972708ae11f9363f8080a); Gates 5 and 6 checked

## Evidence

| Check | Result | Notes / output snippet |
|-------|--------|------------------------|
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☑ pass | tests/migrate.test.ts (AC 1: up/down/up with a seeded chunk row), tests/chunk.test.ts (AC 2: step `chunk`, no OPENAI_API_KEY, re-run adds 0 rows), tests/dedupe.test.ts + tests/check-and-dedupe.test.ts (AC 3), tests/config.test.ts (DEDUPE_JACCARD, DEDUPE_COSINE refused), tests/save-ladder.test.ts + tests/level-generator-step.test.ts (SC 4: ladder saved unverified, job done, no embedder), tests/level-generators-subject.test.ts (AC 5), tests/repo-config.test.ts (.env.example). `bun test`: 444 pass, 0 fail. |
| Verification command run | ☑ pass | 2026-11-19T10:26:50Z. `bun run typecheck`: no error. `bun run lint`: `Checked 118 files ... No fixes applied.` / `check-tokens: 0 color literals`. `bun test migrate chunk dedupe check-and-dedupe save-ladder level-generator config`: 109 pass, 0 fail. `bun test`: 444 pass, 0 fail, Ran 444 tests across 40 files. `cd eval && bun test`: 77 pass, 0 fail. `bun run test:e2e -- start-flow`: 6 passed. AC 4 grep (`openai|embedd?ing|embedder|cosine`): only the DEDUPE_COSINE refusal (config.ts + its test), the "no OPENAI_API_KEY" test, migrate/chunk tests that assert the columns are gone, and the concept name "Embeddings" in e2e/test data. `bun run db:migrate` was not run (no DATABASE_URL here); migrations are applied to a scratch DB by tests/migrate.test.ts. |
| Negative cases hold | ☑ pass | DEDUPE_COSINE refused by name; DEDUPE_JACCARD outside (0, 1] refused; empty / punctuation-only text never a duplicate; distinct-fact pair kept; chunk step exhausting retries → `failed / chunk-failed` (red with a wrong reason, then green); eval subject without GITHUB_TOKEN fails fast with no model call |
| verify | ☑ pass | auto-run by hook, session 73d99fb0-c0a2-4a9c-890d-cf93cea6e55c, commit 2e2108ec4a024bb76bd972708ae11f9363f8080a, log .claude/verify-runs/T031-2e2108ec4a02.log — pass |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | ☑ pass | `git diff main...HEAD` (30 files) plus direct callers, split between two independent reviewers (pipeline core; migration, eval, e2e) and one security reviewer; kit files and untouched modules skipped |
| Full smoke suite still green (no regression) | ☑ pass | `bun test` 445 pass / 0 fail on f3aff3e; eval 77 pass; e2e start-flow 6 passed |
| **Companion score (easy-verifier)** | ☑ N/A | Neither companion tool was run for this task |
| **UI: Visual regression (diff or verdict pasted)** | ☑ N/A | Pure backend task: no UI section in the guide, no client file changed |
| **UI: Design-system compliance (tokens/colors/typography verified)** | ☑ N/A | Pure backend task: no UI section in the guide, no client file changed |
| **UI: Responsiveness at target viewports** | ☑ N/A | Pure backend task: no UI section in the guide, no client file changed |

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
