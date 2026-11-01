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

## Auto decisions

Mode: auto
1. Left the branch unmerged — RULE: `docs/claude-md/tracks.md` `### Never in auto mode`
2. Added an e2e test for retries running out, because `onFailure` had no test and it is the only path out of `running` — RULE: `.claude/skills/code-review/SKILL.md` § Finding Classification
3. Left the P2 and P3 findings unfixed — RULE: `.claude/skills/code-review/SKILL.md` § Phase 4 — Apply Safe Fixes
Findings: P1 fixed: no test for `onFailure` (the path passed unchanged once tested). P2 `src/start/jobs.ts:54` a job left open forever blocks that repo + SHA for everyone: a process crash between the insert and the event send, or a function that never runs, leaves `queued` or `running`, and later callers get the same job with no recovery. P2 `src/start/github.ts:127` a UTF-16 README decodes with NUL bytes, which Postgres text refuses, so the job would end `github-error` with a wrong message (read from the code, not run). P3 long URLs can exceed the cookie limit when encoded, so the return to `/start` is lost; P3 `github.com/o/n` with no scheme is rejected; P3 `pnpm audit --prod` 2 moderate, `minimatch` and `glob`, both transitive through inngest's telemetry dependencies; P3 a 500 on `/api/*` returns HTML, not JSON; P3 no per-learner limit on `/api/start` (cut list; T017 cost cap).
Checks: tests `pnpm test` and `pnpm test:e2e` — 110 unit and 25 browser tests passed; reviews code-review — 0 P0, 1 P1 fixed, 2 P2, 5 P3; migration-safety — GO, reversible, no downtime, additive, production-copy check not applicable because no production data exists; security-review — skill ran through a temporary `origin/HEAD` ref; no findings at confidence 8 or above; a step-limit hook stopped the first reviewer after a partial read, so a second reviewer read the 7 remaining files in full; startup-reads check — pass, the report names `PROJECT_SPEC.md`, `tasks/TASK_GUIDE_T005.md`, `agents/backend.md`; real run: `/api/inngest` forged POST in production mode — printed `{"message":"Unauthorized"}` 401 (auto-checked, not /verify)
Memory: memory/learnings.md — step limit counts all agents of a task; memory/learnings.md — open jobs can block a repo + SHA forever
Not done: merge (yours); auto verify: running (T182); real run with a `GITHUB_APP_TOKEN` (yours, none here); HTML review reports not generated; 11 of 13 new screenshots not viewed by the reviewer

---

## Evidence

| Check | Result | Notes / output snippet |
|-------|--------|------------------------|
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☑ pass | `test/repo-url.test.ts`, `test/start-ladder.test.ts`, `test/fetch-repo.test.ts`, `test/jobs.test.ts`, `e2e/start-flow.spec.ts`. Reviewer rerun 2026-11-01: `Test Files  9 passed (9)`, `Tests  110 passed (110)`; Playwright `25 passed (22.9s)`, including the reviewer-added test for retries running out. |
| Verification command run | ☑ pass | Reviewer rerun in the worktree: `pnpm install --frozen-lockfile` ok; `pnpm db:migrate`, `db:migrate:down`, `db:migrate` ok, 6 app tables present; `pnpm typecheck` clean; `pnpm lint` exit 0; `pnpm test` and `pnpm test:e2e` as above. Dependency ages: inngest 2026-10-14, @inngest/test 2026-03-25, inngest-cli 2026-10-06 (rule: at least 2 weeks old). `pnpm audit --prod`: 2 moderate, both transitive under inngest (see P3). |
| Negative cases hold | ☑ pass | Tests pass for rate limit (no snapshot), repo 404, gitlab URL, unknown job, signed-out API 401. Reviewer probe of `/api/inngest` in production mode, forged unsigned POST: 401 `Unauthorized` with a signing key; 500 `internal_server_error` and nothing run with no key. |
| verify | ☐ pass / ☐ fail / ☐ N/A | [what was observed — must literally state "pass" or "fail" here too, e.g. "skill run, feature confirmed working — pass": the merge gate scans this Notes column for the word "pass", not just the Result column] |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | ☑ pass | Reviewed `src/**`, migration, `public/job-status.js`, config, test stub and e2e spec. Skipped lockfile and fixture bodies. `lane_check`: `lane: C2, 43 files, 1970 lines, EXCEEDS (files 43 > 14; lines 1970 > 500)` plus an unpredicted list of almost every file (warn-only; the guide Files table did not match the layout, and screenshots and fixtures count). Findings: P0 0, P1 1 fixed, P2 2, P3 5, listed under Auto decisions. |
| Full smoke suite still green (no regression) | ☑ pass | Same run: the 3 sign-in and 4 ui browser specs from T003 pass, and all earlier unit tests pass. |
| **Companion score (easy-verifier)** | ☑ N/A | The companion tool was not run for this task. |
| **UI: Visual regression (diff or verdict pasted)** | ☑ pass | Reviewer verdict after viewing `e2e/screenshots/job-failed-mobile.png` and `e2e/screenshots/job-queued-desktop.png`: status text is the main element, the long name wraps, the failed state shows the reason and reset time in plain words, no stack trace or raw JSON — pass. The other 11 screenshots were not viewed by the reviewer; the implementer viewed `start-unsupported-desktop.png`. |
| **UI: Design-system compliance (tokens/colors/typography verified)** | ☑ pass | `e2e/start-flow.spec.ts` computed-style assertions against the token file pass for 4 states at 3 viewports in the reviewer rerun. |
| **UI: Responsiveness at target viewports** | ☑ pass | `e2e/start-flow.spec.ts` at 360, 768 and 1280 px pass in the reviewer rerun; no horizontal scroll. |

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

**WITNESS**: Supervisor reran the verification commands on 2026-11-01 in `.claude/worktrees/T005`; trace `memory/event-trace/T005.jsonl`.