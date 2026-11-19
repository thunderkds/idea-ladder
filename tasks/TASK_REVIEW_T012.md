# TASK_REVIEW — T012: MCQ pass test — score vs stored keys, randomized pool, rate-limited retakes, append-only evidence record + SHA-256

> Sibling of `tasks/TASK_GUIDE_T012.md`. Everything here is **filled by the reviewer at Stage
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
2. A verified question is any saved `mcqs` row of the ladder + level (no status column in T012; T016 adds `removed`); asked = min(10, pool); `pool-too-small` below `MIN_MCQ_POOL` 8; pass iff correct*5 >= asked*4; retake avoidance when pool >= 2 x asked — DEBATED: no column, min(10, pool), floor 8, ratio 4/5 (Advocate 1: add `mcqs.status` in T012, min(10, pool) floor 8, ratio 4/5; Advocate 2: add `mcqs.status` in T012, min(10, pool) floor 8, ratio 4/5, retake avoidance at 2 x asked; Advocate 3: no column, min(10, pool) floor 8, ratio 4/5) ⚠ decided for you — please review
3. Migration numbered 0011, because T031 owns 0010 — FACT: tasks/TASK_GUIDE_T031.md:71 "| 1 | New migration `0010_drop_chunk_embeddings` drops `chunks.embedding`"
4. Spawn model claude-opus-5-5 (C2, Risk High) — FACT: PROJECT_SPEC.md:80 "| claude | `claude` | haiku-5-5 | sonnet-5-5 | sonnet-5-5 or opus-5-5 | opus-5-5 |"
5. A fail returns the `cards` of the same ladder + level whose chunk a missed MCQ cites (the only card-to-question link) — FACT: migrations/0009_ladder_content.up.sql:13 "-- Kept review cards; chunk_id is the chunk the card cites (original text only, NFR-006)."
6. `evidence.pass` holds the pass mark (a number), as in the source's evidence example — FACT: docs/REQUIREMENT_SOURCE.md:502 "diffQuestions":{"asked":5,"correct":4,"pass":4}},"verifiedBy":"verifier@1.3.0",
7. Stage 4 fix set: fix the P2 (parallel-start test for the rate-limit lock); cut the 9 P3s (TRUNCATE bypass → T018 deploy role; 0011 round-trip with seeded rows; NFC storage; learner/ladder CHECK; 30 min / 24 h boundary tests; `signature?` field kept for T019; shared id regex; per-ladder passedLevels query; 200 vs 201) — DEBATED: fix the P2 only (Advocate 1: fix the P2 and the 0011 round-trip test, cut 8; Advocate 2: fix the P2 and the 0011 round-trip test, cut 8; Advocate 3: fix the P2 only, cut 9) ⚠ decided for you — please review
8. Lane check EXCEEDS (15 files > 14; 1158 lines > 500) is accepted: 6 of the files are new tests — RULE: .claude/skills/code-review/SKILL.md:74 "It is warn-only"
9. The append-only trigger covers UPDATE and DELETE only, as `review_log` does — FACT: migrations/0005_review.up.sql:56 "  BEFORE UPDATE OR DELETE ON review_log"
Checks: tests `bun test` — 476 pass / 0 fail (fix agent, 9f74e5f); `bun test -t T012` — 33 pass / 0 fail (Supervisor, 9f74e5f); the parallel-start test fails 3 of 3 runs with the `FOR UPDATE` lock removed (`Expected length: 3, Received length: 4`); typecheck and lint clean; reviews code-review — 0 P0, 0 P1, 1 P2 fixed (9f74e5f), 9 P3 cut; security-review — no findings (confidence ≥ 8); migration-safety (0011) — GO; real run `bun test mcq-routes` — both routes through the app's HTTP handler: start 200 without keys, 4th start 429 + retryAt, submit pass, ladder view passed / open / locked (auto-checked, not /verify)
Memory: memory/decisions.md — T012 merged entry (written at merge)
Not done: the pass-test screens (T030); TRUNCATE hardening of `evidence_records` (T018 deploy role); auto verify: ☑ pass (session e0c290dd-4514-4b3f-8052-1662afafed08, commit c0d72ab3a6aa703774f9abe3a353944598a3986d, log .claude/verify-runs/T012-c0d72ab3a6aa.log); merge (admin: after the auto verify pass)
Closed: row moved to Done 2026-11-19 — auto verify pass (session e0c290dd-4514-4b3f-8052-1662afafed08, commit c0d72ab3a6aa703774f9abe3a353944598a3986d); Gates 5 and 6 checked

## Evidence

| Check | Result | Notes / output snippet |
|-------|--------|------------------------|
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☑ pass | backend-developer 2026-11-19T10:33:05Z: `tests/evidence.test.ts` (SC 3, NFC), `tests/evidence-table.test.ts` (SC 4, AC 5 trigger + unique), `tests/mcq-pass-test.test.ts` (AC 1, AC 6, SC 1, SC 5, SC 7, locked 404), `tests/mcq-submit.test.ts` (AC 2-5, SC 2, SC 6, SC 7, concurrency), `tests/mcq-routes.test.ts` (routes, real passedLevels in ladder view, 401/404/422/429), `tests/mcq-no-llm.test.ts` (AC 7 / NFR-002); `tests/migrate.test.ts` updated for 0011 up/down/up. `bun test -t "T012"`: ` 32 pass / 443 filtered out / 0 fail / 180 expect() calls / Ran 32 tests across 46 files. [15.65s]`. Full `bun test` (before the no-LLM file): ` 473 pass / 0 fail / Ran 473 tests across 45 files. [54.99s]` |
| Verification command run | ☑ pass | `bun install --frozen-lockfile && bun run typecheck && bun run lint && bun test -t "T012"` at 2026-11-19T10:33:05Z, exit 0: `Checked 390 installs across 347 packages (no changes)` / `$ tsc --noEmit` (no output) / `Checked 130 files in 69ms. No fixes applied.` / `check-tokens: 0 color literals outside src/client/tokens.css` / ` 32 pass  443 filtered out  0 fail  180 expect() calls  Ran 32 tests across 46 files. [15.65s]` |
| Negative cases hold | ☑ pass | pool of 7 → `pool-too-small`, no attempt row; 7 of 9 fails; foreign question id 422, second submit 409, submit at 31 min 409, attempt unchanged; 4th start 429 + retryAt (sequential and parallel); UPDATE / DELETE on evidence_records rejected by the trigger; another learner's attempt and a locked level → 404; option text or index out of range → 400; an LLM mocked to throw is never called |
| verify | ☑ pass | auto-run by hook, session e0c290dd-4514-4b3f-8052-1662afafed08, commit c0d72ab3a6aa703774f9abe3a353944598a3986d, log .claude/verify-runs/T012-c0d72ab3a6aa.log — pass |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | ☑ pass | `git diff main...HEAD` (16 files) plus direct callers of `passedLevels` (review.ts, reminders.ts, progress.ts, offline.ts, ladder-view.ts), split between two independent reviewers (scoring/routes; evidence/migration) and one security reviewer |
| Full smoke suite still green (no regression) | ☑ pass | `bun test` 476 pass / 0 fail on 9f74e5f; wiring the real `passedLevels` broke no existing test |
| **Companion score (easy-verifier)** | ☑ N/A | Neither companion tool was run for this task |
| **UI: Visual regression (diff or verdict pasted)** | ☑ N/A | Pure backend task: no UI section in the guide, no client file changed (the screens are T030) |
| **UI: Design-system compliance (tokens/colors/typography verified)** | ☑ N/A | Pure backend task: no UI section in the guide, no client file changed (the screens are T030) |
| **UI: Responsiveness at target viewports** | ☑ N/A | Pure backend task: no UI section in the guide, no client file changed (the screens are T030) |

---

## Demonstration

> Anchors what this task delivered to an observable before/after pair. BEFORE has no `N/A` path:
> if the task changes executable code, BEFORE is a pasted, timestamped terminal capture taken
> **before any implementation commit exists**; if it does not (docs, templates, skill-instruction
> text), BEFORE is the **verbatim prior content** of what changed — a quoted excerpt, not a command.

**BEFORE**: captured by backend-developer before the first implementation commit (HEAD be13851), command
`date -u +%Y-%m-%dT%H:%M:%SZ; bun test -t "T012" 2>&1 | tail -6; ls migrations | grep 0011 || echo "no 0011 migration"`:

```
2026-11-19T10:23:21Z
bun test v1.4.4 (38afee6c8)

error: regex "T012" matched 0 tests. Searched 40 files (skipping 443 tests) [155.00ms]
no 0011 migration
```

**AFTER**: same command, run by backend-developer after commit deb179e:

```
2026-11-19T10:33:05Z
bun test v1.4.4 (38afee6c8)
 32 pass
 443 filtered out
 0 fail
 180 expect() calls
Ran 32 tests across 46 files. [15.65s]
0011_mcq_pass_test.down.sql
0011_mcq_pass_test.up.sql
```

**DELTA**: [one sentence — what a user can now do that they could not before]

**WITNESS**: [who ran it and when — derived from `memory/event-trace/Txxx.jsonl`, never the
implementing agent alone]
