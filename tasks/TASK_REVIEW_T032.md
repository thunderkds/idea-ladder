# TASK_REVIEW — T032: Generated cards never reach the review queue (one card table: `review_cards`)

> Sibling of `tasks/TASK_GUIDE_T032.md`. Everything here is **filled by the reviewer at Stage
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
1. Opened T032 as a bugfix task during the run: generated cards never reach the review queue — FACT: docs/decisions/0003-review-tables.md:7 "`review_cards` and adds columns only if it must; T011 only reads it."
2. Mental model confirmed by the Supervisor from the code, not by the user — RULE: docs/claude-md/tracks.md `### Every user stop and its auto rule`
3. Fix shape: one table `review_cards`; migration 0012 adds nullable `position` + `chunk_id`, copies `cards` with a count check, drops `cards`; down never deletes `review_cards` rows — DEBATED: one table, down keeps every review_cards row (Advocate 1: one table, copy then drop `cards`, down deletes the copied rows; Advocate 2: one table, copy then drop `cards`, down never deletes `review_cards` rows) ⚠ decided for you — please review
4. Spawn model claude-sonnet-5-5 (C2, Risk Medium) — FACT: PROJECT_SPEC.md:80 "| claude | `claude` | haiku-5-5 | sonnet-5-5 | sonnet-5-5 or opus-5-5 | opus-5-5 |"
5. Up pairs same-text `review_cards` rows before copying (the implementer's change to the fix shape), because down drops the only other key — FACT: migrations/0012_review_cards_content.down.sql:22 "ALTER TABLE review_cards DROP COLUMN chunk_id, DROP COLUMN position;"
6. Stage 4: the P2 (pairing not documented) fixed by the Supervisor in ADR 0003 (885d48f); the 3 P3s cut (near-tautological count check; `public.cards` in migrate tests; no test of adopting an identical hand-seeded row) — RULE: .claude/skills/code-review/SKILL.md:142 "Do not apply P2/P3 fixes automatically — present them as suggestions only."
7. Diagnosis gate "3–5 ranked hypotheses" not met: only the guide's divergence point was tested, and it was confirmed on the first run — FACT: tasks/TASK_REVIEW_T032.md Demonstration BEFORE (2026-11-19T10:53:39Z, reviewQueue returned [] after saveLadder)
Checks: tests `bun test` — 481 pass / 0 fail (agent, afc46b2); `bun test -t T032` — 3 pass / 0 fail and `bun test review-generated-cards mcq-submit migrate` — 42 pass / 0 fail (Supervisor, 885d48f); typecheck and lint clean; grep `INTO cards|FROM cards` — "no cards table use left"; reviews code-review — 0 P0, 0 P1, 1 P2 fixed (885d48f), 3 P3 cut; security-review — no findings (confidence ≥ 8); migration-safety (0012) — GO; real run `bun test review-generated-cards` — saveLadder then reviewQueue returns the ladder's L0 cards and rateCard accepts a saved card id (auto-checked, not /verify)
Memory: memory/decisions.md — T032 merged entry (written at merge); memory/learnings.md — test generation and review through one path
Not done: auto verify: running (T182); merge (admin: after the auto verify pass)

## Evidence

| Check | Result | Notes / output snippet |
|-------|--------|------------------------|
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☑ pass | AC1 tests/review-generated-cards.test.ts; AC2 tests/mcq-submit.test.ts (SC 2); AC3 tests/migrate.test.ts "T032 0012_review_cards_content"; AC4 grep empty. `bun test -t T032`: 3 pass 0 fail |
| Verification command run | ☑ pass | typecheck + lint clean; `bun test migrate save-ladder mcq review offline`: 115 pass 0 fail; `bun test`: 481 pass, 0 fail (Ran 481 tests across 47 files); grep: "no cards table use left" |
| Negative cases hold | ☑ pass | regression test red on main (reviewQueue [] after saveLadder, 0 pass / 2 fail); 0012 count check raises on a mismatch; the unique index rejects a duplicate position; down never deletes a `review_cards` row, so a `review_log` reference stays valid; hand-seeded rows (NULL chunk_id) are left out of `reviewCardIds` |
| verify | ☐ pass / ☐ fail / ☐ N/A | [what was observed — must literally state "pass" or "fail" here too, e.g. "skill run, feature confirmed working — pass": the merge gate scans this Notes column for the word "pass", not just the Result column] |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | ☑ pass | `git diff main...HEAD` (13 files) plus every reader of `review_cards` (review.ts, offline.ts, mcq-test.ts, reminders via reviewQueue); one code reviewer (migration, correctness, testing, over-engineering) and one security reviewer |
| Full smoke suite still green (no regression) | ☑ pass | `bun test` 481 pass / 0 fail on afc46b2 |
| **Companion score (easy-verifier)** | ☑ N/A | Neither companion tool was run for this task |
| **UI: Visual regression (diff or verdict pasted)** | ☑ N/A | Pure backend bugfix: no client file changed |
| **UI: Design-system compliance (tokens/colors/typography verified)** | ☑ N/A | Pure backend bugfix: no client file changed |
| **UI: Responsiveness at target viewports** | ☑ N/A | Pure backend bugfix: no client file changed |
| Repro loop | ☑ pass | `bun test tests/review-generated-cards.test.ts` at 2026-11-19T10:53:39Z: 0 pass / 2 fail, reviewQueue returns [] after saveLadder (see Demonstration BEFORE) |
| Regression test | ☑ pass | tests/review-generated-cards.test.ts (red before, 2 pass after); tests/mcq-submit.test.ts SC 2 now rates each reviewCardId; tests/migrate.test.ts T032 0012 describe |
| Smoke suite | ☑ pass | `bun test review-generated-cards mcq-submit migrate` — 42 pass / 0 fail (Supervisor, 885d48f): save → queue → rate, failed MCQ → rateable reviewCardIds, 0012 up/down/up |

---

## Demonstration

> Anchors what this task delivered to an observable before/after pair. BEFORE has no `N/A` path:
> if the task changes executable code, BEFORE is a pasted, timestamped terminal capture taken
> **before any implementation commit exists**; if it does not (docs, templates, skill-instruction
> text), BEFORE is the **verbatim prior content** of what changed — a quoted excerpt, not a command.

**BEFORE**: 2026-11-19T10:53:39Z, `bun test tests/review-generated-cards.test.ts` on main code (no fix commit yet):
```
- [["1","L0","front L0 0"],["1","L0","front L0 1"]]   (expected)
+ []                                                  (received: reviewQueue empty after saveLadder)
(fail) T032 generated cards reach the review queue > AC 1: the review queue returns the saved ladder's L0 cards for a learner with L0 open
(fail) T032 generated cards reach the review queue > a saved card id is accepted by rateCard   (queue first card undefined)
 0 pass / 2 fail
```

**AFTER**: same command after commit f300533: `bun test tests/review-generated-cards.test.ts` gives 2 pass / 0 fail (queue returns the two L0 cards of the saved ladder; rateCard accepts a saved card id).

**DELTA**: [one sentence — what a user can now do that they could not before]

**WITNESS**: [who ran it and when — derived from `memory/event-trace/Txxx.jsonl`, never the
implementing agent alone]
