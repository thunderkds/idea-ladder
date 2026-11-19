# TASK_REVIEW — T016: "This question seems wrong" flag; frequently flagged cards regenerated or removed

> Sibling of `tasks/TASK_GUIDE_T016.md`. Everything here is **filled by the reviewer at Stage
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
2. A flag names its kind (`card` = `review_cards`, `mcq` = `mcqs`), because the two tables have separate id spaces; key `(learner_id, kind, question_id)` — SAFER OPTION: one table per kind would duplicate the handler; one key with the kind keeps both id spaces apart ⚠ decided for you — please review
3. `removed` is a `status` column (default `active`) on both `review_cards` and `mcqs`, added in migration 0013; filters only in the review queue, the offline pack and the MCQ draw, never in scoring or evidence — SAFER OPTION: the smallest change that keeps AC 4 (a flag never changes scoring) ⚠ decided for you — please review
4. On removal, one `ladder/question.regenerate` event; MCQs are regenerated through T008/T009 exports and inserted only if every check passes; card events are a logged no-op (no card regenerator exists) — SAFER OPTION: reuse the existing verification pipeline instead of a new one; a card stays removed with no replacement (guide edge case "question stays removed; no replacement") ⚠ decided for you — please review
5. The flag button ships on the review card only; T030 adds it to the MCQ screen it builds, using the same API — SAFER OPTION: the MCQ attempt screen does not exist yet ⚠ decided for you — please review
6. Spawn models claude-sonnet-5-5 for the backend and frontend parts (C1) — FACT: PROJECT_SPEC.md:80 "| claude | `claude` | haiku-5-5 | sonnet-5-5 | sonnet-5-5 or opus-5-5 | opus-5-5 |"
7. Stage 4: the P1 (keyboard shortcuts fired inside the reason box) fixed in 0d4e855; the 2 P3s (concurrent replacement position; double-processing guard) cut — RULE: .claude/skills/code-review/SKILL.md:142 "Do not apply P2/P3 fixes automatically — present them as suggestions only."
8. Lane check EXCEEDS (24 files > 6; 1027 lines > 250) accepted: migration, consumer, UI and 6 screenshots under a C1 label — RULE: .claude/skills/code-review/SKILL.md:74 "It is warn-only"
Checks: tests `bun test --timeout 60000` — 546 pass / 0 fail (agents); `bun test -t T016` — 15 pass / 0 fail (Supervisor, 0d4e855); `bun run test:e2e -- --grep T016` — 5 passed; `bun run test:e2e -- e2e/review.e2e.ts` — 11 passed; typecheck and lint clean; reviews code-review — 0 P0, 1 P1 fixed (0d4e855), 2 P3 cut; migration-safety (0013) — GO (additive; down lossy, throwaway only); real run: the Playwright flow on the running app (e2e/serve.ts) — flag → "Flagged — thanks" → next card; screenshot e2e/artifacts/T016/flag-confirm-360.png checked by the Supervisor (auto-checked, not /verify)
Memory: memory/decisions.md — T016 merged entry (written at merge)
Not done: the flag button on the MCQ screen (T030); card regeneration (no card regenerator); the 2 pre-existing e2e/pwa.e2e.ts failures (fail on main too); auto verify: running (T182); merge (admin: after the auto verify pass)

## Evidence

| Check | Result | Notes / output snippet |
|-------|--------|------------------------|
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☑ pass (backend AC 1-5 and the backend half of AC 6) | tests/question-flags.test.ts (AC 1-6 server side, threshold, parallel flags, scoring unchanged), tests/question-regenerate.test.ts (consumer), tests/migrate.test.ts (0013 up/down). `bun test -t "T016"` (2026-11-19T11:32:56Z): 15 pass, 0 fail, 92 expect() calls. Playwright (AC 6 UI) is the frontend agent's. |
| Verification command run | ☑ pass (backend part) | `bun run typecheck` clean; `bun run lint`: `Checked 139 files in 75ms. No fixes applied.` + `check-tokens: 0 color literals`; `bun test --timeout 60000`: `546 pass 0 fail 3186 expect() calls Ran 546 tests across 53 files`. Playwright not yet run (frontend). |
| Negative cases hold | ☑ pass | repeat flag → 200, 1 row; 2 flaggers → status unchanged; same learner ×3 → count 1; 4th flag → no event; two parallel flags at count 2 → one status change, one event; a failing send rolls the flag back (503); no session → 401; ladder not started / unknown id → 404, nothing written; open attempt holding a removed MCQ still scores all 10, no evidence written; reason `<b>wrong</b>` stored and shown as text; keys typed in the reason box do not reveal or rate (red before 0d4e855) |
| verify | ☐ pass / ☐ fail / ☐ N/A | [what was observed — must literally state "pass" or "fail" here too, e.g. "skill run, feature confirmed working — pass": the merge gate scans this Notes column for the word "pass", not just the Result column] |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | ☑ pass | `git diff main...HEAD` (25 files) plus direct callers (review queue, offline pack, MCQ draw, app/main wiring); one reviewer covering correctness, testing, the biome-incident diff of review.ts/offline.ts, SQL filters, threshold transaction, consumer and client |
| Full smoke suite still green (no regression) | ☑ pass | `bun test --timeout 60000` 546 pass / 0 fail; e2e 61 passed + the 2 pre-existing e2e/pwa.e2e.ts failures (:584, :743), which fail the same way on main (T007 Auto decision 11) |
| **Companion score (easy-verifier)** | ☑ N/A | Neither companion tool was run for this task |
| **UI: Visual regression (diff or verdict pasted)** | ☑ pass | Screenshots in e2e/artifacts/T016/: flag-button-{360,768,1280}.png and flag-confirm-{360,768,1280}.png. Own visual verdict (rubric: secondary, low-emphasis button below the card; does not compete with the rating buttons; label exactly `This question seems wrong`): matches spec at 360, 768 and 1280 (underlined muted text, no fill, below Again/Hard/Good/Easy; confirmation shows Reason field + Send/Cancel, rating buttons stay put). The MCQ screen does not exist yet (T030), so only the review card was checked. |
| **UI: Design-system compliance (tokens/colors/typography verified)** | ☑ pass | Playwright computed style (test "T016 flag: design checks..."): fontSize 14px (>= 14), font-family `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` (theme stack), color rgb(90, 93, 102) == var(--color-text-muted), height 44px (>= 44), width 328/225/225 px (>= 44), gap to rating buttons 24px (>= 16) at 360/768/1280. `bun run lint`: `check-tokens: 0 color literals outside src/client/tokens.css`. |
| **UI: Responsiveness at target viewports** | ☑ pass | 360/768/1280 px: scrollWidth 360/768/1280 (<= viewport) in both states; button width 328 of 360 main (full width) at 360, 225 px (not full width) at 768 and 1280; rating buttons top stayed at y=424 after opening the confirmation (no shift). |

---

## Demonstration

> Anchors what this task delivered to an observable before/after pair. BEFORE has no `N/A` path:
> if the task changes executable code, BEFORE is a pasted, timestamped terminal capture taken
> **before any implementation commit exists**; if it does not (docs, templates, skill-instruction
> text), BEFORE is the **verbatim prior content** of what changed — a quoted excerpt, not a command.

**BEFORE**: (command: `date -u +%Y-%m-%dT%H:%M:%SZ; bun test -t "T016" 2>&1 | tail -4; ls migrations | grep 0013 || echo "no 0013 migration"`)
```
2026-11-19T11:26:06Z
bun test v1.4.4 (38afee6c8)

error: regex "T016" matched 0 tests. Searched 51 files (skipping 531 tests) [155.00ms]
no 0013 migration
```

**AFTER**: (command: `bun run test:e2e -- --grep T016`)
```
  ✓  1 e2e/question-flag.e2e.ts:47:1 › T016 flag: Send shows 'Flagged — thanks' and the next card, with the reason sent as text (397ms)
  ✓  2 e2e/question-flag.e2e.ts:58:1 › T016 flag: Cancel closes the confirmation and sends nothing (269ms)
  ✓  3 e2e/question-flag.e2e.ts:68:1 › T016 flag: an error shows a message and keeps the card; Send can be retried (374ms)
  ✓  4 e2e/question-flag.e2e.ts:79:1 › T016 flag: design checks, screenshots and no layout shift at 360 / 768 / 1280 px (748ms)
  4 passed (5.4s)
```
`bun test --timeout 60000`: 546 pass, 0 fail.

**DELTA**: [one sentence — what a user can now do that they could not before]

**WITNESS**: [who ran it and when — derived from `memory/event-trace/Txxx.jsonl`, never the
implementing agent alone]
