# TASK_REVIEW — T005: /start?url= flow, repo fetch job, status page

> Sibling of `tasks/TASK_GUIDE_T005.md`. Everything here is **filled by the reviewer at Stage
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
Paused: auto-mode check failed — tasks/TASK_REVIEW_T005.md has no `## Auto decisions` section starting with `Mode: auto`; no `Memory:` line in the report — run the memory pass before you stop and record it there (each entry written, or `Memory: nothing new`); no test run in memory/event-trace/T005.jsonl — write /home/hungnguyenhuu/workspace/pets/hungnguyen111/idea-ladder/.claude/hooks/.state/active_task.d/$CLAUDE_CODE_SESSION_ID with the task ID (minimal-track step 1): `mkdir -p /home/hungnguyenhuu/workspace/pets/hungnguyen111/idea-ladder/.claude/hooks/.state/active_task.d && printf '%s\n%s\n' "T005" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > /home/hungnguyenhuu/workspace/pets/hungnguyen111/idea-ladder/.claude/hooks/.state/active_task.d/$CLAUDE_CODE_SESSION_ID`, then rerun the task's tests so the trace records them under the task, then stop

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

**BEFORE**: captured before any implementation commit (HEAD `edcb5bd`), command `date -Iseconds; grep -n "'/start\|/api/start\|/jobs/" src/app.tsx; ls migrations`:

```
2026-11-01T12:44:09+07:00
(grep: no match, exit 1 — no /start, /api/start or /jobs/ route in src/app.tsx)
1762000000000_init-users-sessions.sql
```

**AFTER**: same command, run after the change (working tree, before the commit):

```
2026-11-01T14:16:02+07:00
110:  app.get('/start', async (c) => {
131:      return c.redirect(result.kind === 'hit' ? `/ladders/${result.ladderId}` : `/jobs/${result.jobId}`, 302);
139:  app.post('/api/start', async (c) => {
169:  app.get('/api/jobs/:jobId', async (c) => {
184:  app.get('/jobs/:jobId', async (c) => {
1762000000000_init-users-sessions.sql
1762000001000_ladder-generation.sql
```

Real run (local Inngest dev server 1.46.0, app on :3101, real GitHub API with NO token — the unauthenticated limit was enough; `GITHUB_APP_TOKEN` was not set), 2026-11-01T14:14:02+07:00:

```
call 1  POST /api/start {"url":"https://github.com/developit/mitt"}  -> {"jobId":"dbbc770d-86ac-43d6-a568-762adbb57289"} HTTP 202   (0.486 s total incl. the real GitHub call)
status  GET /api/jobs/dbbc770d-...                                   -> {"status":"fetched"}
call 2  POST /api/start {"url":"developit/mitt"}                     -> {"jobId":"dbbc770d-86ac-43d6-a568-762adbb57289"} HTTP 202   (same jobId)
db      generation_jobs: 1 row, fetched | repo_snapshots: developit/mitt 6b41670516ed8e8b738612f60491995470aa63b3 main, readme 6273 chars, 16 open issues, 0 good first, dep_files ["package.json"], 10 tree entries
        repo_confidence: 0.90 high fallback=false ["0 good first issue (-0.1)"]
(hand-made) insert into ladders (developit/mitt, 6b41...)
call 3  POST /api/start {"url":"https://github.com/Developit/Mitt/tree/main"} -> {"ladderId":"b5512b30-902f-4453-8673-86855eb28ce4"} HTTP 200 ; generation_jobs still 1 row
other   nonexistent-owner-zz9/nonexistent-repo-zz9 -> {"error":"repo-not-found"} HTTP 404 ; https://gitlab.com/o/n -> {"error":"unsupported-url"} HTTP 422
signed-out GET /start?url=... -> 302 location: /auth/github
```

Retry on the real Inngest dev server (local flaky GitHub stand-in: first `GET /repos/lukeed/dset` answers 503): the stand-in log shows `flaky: 503 for /repos/lukeed/dset`, then `serve /repos/lukeed/dset` again, then the rest of the reads once; job `fetched`, 1 snapshot row; the dev server logged one `ladder/generate.requested` publish per job (no re-send).

**DELTA**: A signed-in learner can open `/start?url=<GitHub repo URL>` (or POST `/api/start`) and get a cached ladder or a background Inngest job whose first step reads the repo at a pinned commit and scores confidence, with a polling status page at `/jobs/:jobId`; before, the app had no `/start`, no job and no repo tables.

**WITNESS**: [who ran it and when — derived from `memory/event-trace/T005.jsonl`, never the
implementing agent alone]
