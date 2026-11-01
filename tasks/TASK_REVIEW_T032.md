# TASK_REVIEW — T032: Record every learner who starts a ladder (cache hit and shared job)

> Sibling of `tasks/TASK_GUIDE_T[NNN].md`. Everything here is **filled by the reviewer at Stage
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
1. Signed the Requirement Fidelity Gate as `auto (Supervisor)` — RULE: `docs/claude-md/tracks.md` `### Every user stop and its auto rule` (row 13)
2. Spawned backend-developer on `claude` with this session's model (Opus) — FACT: PROJECT_SPEC.md:82 "Cells stay empty; spawns use the CLI and model this session runs as"
3. Kept C1 although `lane_check` printed `EXCEEDS (files 10 > 6)`; half the files are test/e2e seeds — RULE: skills/code-review/SKILL.md:74 "It is warn-only"
4. Accepted the agent's edits to `e2e/ladder-view.spec.ts` and `e2e/review.spec.ts` (seed the new table) — FACT: tasks/TASK_GUIDE_T032.md:116 "`src/auth/**`, `public/**`, service worker files (T015)"
5. Accepted the unbatched backfill in the migration — FACT: PROJECT_KANBAN.md:24 "**T018** — Deploy v1" (still Todo: no production data yet)
6. Ran `security-review` with a temporary `refs/remotes/origin/HEAD`, deleted after — RULE: memory/learnings.md:31 "To run it: in the task worktree, `git update-ref refs/remotes/origin/HEAD main`, run the skill, then delete that ref"
7. Companion score row N/A: MCP cannot read the worktree path, CLI not importable — RULE: skills/score/SKILL.md § The ladder (rung 3)
Checks: tests `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` — 151/151 unit, 45/45 e2e, typecheck and lint clean; reviews code-review — P0 0, P1 0, P2 1, P3 1; security-review — no findings; migration-safety (by hand, agent) — GO; real run `pnpm test test/ladder-learners.test.ts` — printed `Tests  8 passed (8)` (auto-checked, not /verify)
Memory: memory/learnings.md — two e2e runs at once collide (port 4010, `il_e2e`); memory/learnings.md — `review_log` append-only blocks shared test cleanup; memory/learnings.md — easy-verifier MCP cannot see worktrees
Not done: merge (yours); auto verify: running (T182); easy-verifier score (container fix is the operator's)

## Evidence

| Check | Result | Notes / output snippet |
|-------|--------|------------------------|
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☑ pass | `test/ladder-learners.test.ts` (AC 1–6 + cascade edge); `test/migrations.test.ts` lists `ladder_learners`. `pnpm test test/ladder-learners.test.ts` → `Tests  8 passed (8)`; full `pnpm test` → `Test Files  13 passed (13)` / `Tests  151 passed (151)`. Six tests fail when the `addLearner` call is removed (agent check). — pass |
| Verification command run | ☑ pass | Supervisor run 2026-11-01 ~15:10Z in the worktree: `pnpm typecheck` clean, `pnpm lint` clean, `pnpm test` 151 passed, `pnpm test:e2e` `45 passed (29.6s)`. `docker compose up -d db` not needed: `idea-ladder-db-1` already holds 54329. — pass |
| Negative cases hold | ☑ pass | AC 4: a learner with no record gets `[]` from `listMyLadders` and 404 on `/api/review/rating`. AC 6: an insert failure returns 500, creates no job, sends no event, and hands out no ladder id. — pass |
| verify | ☐ pass / ☐ fail / ☐ N/A | [what was observed — must literally state "pass" or "fail" here too, e.g. "skill run, feature confirmed working — pass": the merge gate scans this Notes column for the word "pass", not just the Result column] |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | ☑ pass | Reviewed the diff `main...HEAD` (10 files) plus direct callers: `src/app.tsx` (`startLadder` at 195, 223), `src/review/store.ts` (`unlockedPairs` → `listMyLadders`), `src/start/github.ts` `resolveHead` (lower-case name). Nothing else. — pass |
| Full smoke suite still green (no regression) | ☑ pass | `pnpm test:e2e` → `45 passed (29.6s)`; T010 and T011 unit tests in the 151 pass. Regenerated `e2e/screenshots/review-*.png` restored (random seed names, no UI change). — pass |
| **Companion score (easy-verifier)** | ☑ N/A | MCP `score` returned `target repository path does not exist: /home/hungnguyenhuu/workspace/pets/hungnguyen111/idea-ladder/.claude/worktrees/T032` (container `easy-verifier-mcp-scorer-1` has no workspace mount; `easy-verifier` restarting); `easy_verifier` not importable; stopped at rung 3 |
| **UI: Visual regression (diff or verdict pasted)** | ☑ N/A | pure backend task: no UI change; e2e screenshots restored to committed versions |
| **UI: Design-system compliance (tokens/colors/typography verified)** | ☑ N/A | pure backend task: no UI change |
| **UI: Responsiveness at target viewports** | ☑ N/A | pure backend task: no UI change |

---

## Demonstration

> Anchors what this task delivered to an observable before/after pair. BEFORE has no `N/A` path:
> if the task changes executable code, BEFORE is a pasted, timestamped terminal capture taken
> **before any implementation commit exists**; if it does not (docs, templates, skill-instruction
> text), BEFORE is the **verbatim prior content** of what changed — a quoted excerpt, not a command.

**BEFORE**: captured 2026-11-01T15:03:01Z on `49158be` (no implementation commit yet), by a temporary test
`test/before-ac1.test.ts` (seed a saved `developit/mitt` ladder, learner 1 calls `POST /api/start`, expect it in
`listMyLadders`). Command: `pnpm test test/before-ac1.test.ts`. The test was deleted after the run.

```
AssertionError: expected [] to deeply equal [ { …(2) } ]

- Expected
+ Received

- [
-   {
-     "id": "603ffa30-ac2d-4cc9-a2f4-6d8bafa34703",
-     "repoFullName": "developit/mitt",
-   },
- ]
+ []

 ❯ test/before-ac1.test.ts:14:49
     12|     const res = await postStart(t, cookie, { url: 'developit/mitt' });
     13|     expect(res.status).toBe(200);
     14|     expect(await listMyLadders(t.pool, userId)).toEqual([{ id: ladderI…

 Test Files  1 failed (1)
      Tests  1 failed (1)
   Start at  22:03:01
```

The cache hit answers 200, but the learner's `My ladders` list is empty.

**AFTER**: 2026-11-01 ~15:11Z on `cb70495`, the same scenario as AC 1 in `test/ladder-learners.test.ts` (cache-hit learner, then `listMyLadders`, `/ladders`, review queue, rating). Command: `pnpm test test/ladder-learners.test.ts`.

```
 Test Files  1 passed (1)
      Tests  8 passed (8)
   Start at  22:11:28
```

**DELTA**: A learner who reuses a saved ladder, or joins a job that is still building, now sees that ladder on `My ladders` and gets its review cards.

**WITNESS**: BEFORE by backend-developer sub-agent 2026-11-01T15:03:01Z; AFTER re-run by the Supervisor 2026-11-01 ~15:11Z under T032 (`memory/event-trace/T032.jsonl`).
