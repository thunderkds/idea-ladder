# TASK_REVIEW — T005: /start?url= → read repo with token, pin SHA, cache by repo+SHA, background job (Inngest), status page

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

## Evidence

| Check | Result | Notes / output snippet |
|-------|--------|------------------------|
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☑ pass | `tests/repo-url.test.ts` (AC 1, SC 1), `tests/start-ladder.test.ts` (AC 2–4, 6, SC 2–4), `tests/fetch-repo.test.ts` (AC 5, 6, 8, SC 5–6, via `@inngest/test`), `tests/jobs.test.ts` (AC 7 API), `tests/migrate.test.ts` (0002 up/down), `e2e/start-flow.e2e.ts` (AC 3, AC 7, SC 7, UI). `bun test start-ladder repo-url fetch-repo jobs` at 2026-11-12T09:10:10Z: ` 55 pass / 0 fail / Ran 55 tests across 4 files. [937.00ms]`. Full suite in ci:local: ` 104 pass / 0 fail / Ran 104 tests across 8 files. [1.53s]`. e2e: `6 passed (28.4s)` **Fix batch after Stage 4 reviews (2026-11-12T09:19:31Z, commits `244ae64`, `c724882`):** new `tests/start-ladder-limit.test.ts` (per-learner limit: allowed up to N, 429 at N+1, other learner unaffected, join + cache hit not counted, rows older than 1 h not counted); `tests/config.test.ts` (`START_MAX_NEW_JOBS_PER_HOUR`, production Inngest keys, `INNGEST_SERVE_ORIGIN`); `tests/fetch-repo.test.ts` (404, 401, archived, forged event, unknown job, redirects, non-numeric reset, `.`/`..`); `tests/start-ladder.test.ts` (`[]` from /commits, CR/LF return targets). `bun test` → ` 122 pass` ` 0 fail` `Ran 122 tests across 9 files. [1.82s]`; `bun test start-ladder repo-url fetch-repo jobs` → ` 70 pass` ` 0 fail` `Ran 70 tests across 5 files. [1301.00ms]`. |
| Verification command run | ☑ pass (with 1 environment note) | Run 2026-11-12T09:10:17Z in the worktree. `docker compose up -d db` → `Container wt-t005-db-1 Started` (port 54329 is already published by `wt-t003-db-1`; tests used that Postgres). `bun install --frozen-lockfile` → `Checked 362 installs across 319 packages (no changes)`. `bun run db:migrate` → `Invalid configuration: missing required environment variable(s): DATABASE_URL` / `exit=1` (the worktree has no `.env`; the agent did not apply migrations to the dev DB — Common-Infrastructure owns that). Migrations proven instead on the throwaway `il_ci` DB by `bun run ci:local`: `applied: 0001_init, 0002_start_jobs` / `reverted: 0002_start_jobs` / `applied: 0002_start_jobs`. `bun run typecheck && bun run lint` → `Checked 44 files in 24ms. No fixes applied.` / `check-tokens: 0 color literals outside src/client/tokens.css` / `exit=0`. `bun test start-ladder repo-url fetch-repo jobs` → ` 55 pass` ` 0 fail` `Ran 55 tests across 4 files. [859.00ms]`. `bun run test:e2e -- start-flow` → `6 passed (28.4s)`. `bun run ci:local` (2026-11-12T09:11:04Z) → `ci:local: all steps passed`. **Re-run after the fix batch:** `bun install --frozen-lockfile` → `Checked 362 installs across 319 packages (no changes)`; `bun test` → `122 pass / 0 fail`; `bun run typecheck` → exit 0; `bun run lint` → `Checked 45 files in 23ms. No fixes applied.` / `check-tokens: 0 color literals outside src/client/tokens.css`. `bun run ci:local` (2026-11-12T09:19:35Z): unit `122 pass, 0 fail`; `applied: 0001_init, 0002_start_jobs` / `reverted: 0002_start_jobs` / `applied: 0002_start_jobs`; e2e sign-in `3 passed (2.3m)`; e2e start-flow `6 passed (28.5s)`; `ci:local: all steps passed`. |
| Negative cases hold | ☑ pass | bun test: unsupported URLs (8 forms incl. `javascript:alert(1)`) make no network call; repo 404 → `404 repo-not-found`, no job; rate limit at resolve → `503 rate-limited` + `resetAt`, no job; 403 + `x-ratelimit-remaining: 0` in `fetch-repo` → `failed / rate-limited`, 0 snapshot rows; 5xx once → only `fetch-repo` retried, 0 `sendEvent`; enqueue failure → `503 queue-unavailable`. e2e: `rate limit in fetch-repo -> Failed: rate-limited with the reset time in plain words` ✓; `unsupported URL ... escaped` ✓ (HTTP 400, `<b>` rendered as text, 0 `b` elements); `unknown job id -> Job not found` ✓. The expected log lines `start: GitHub call failed: GitHub API 302 ...` and `enqueue failed: Inngest unreachable` come from these negative tests. **Fix batch:** over `START_MAX_NEW_JOBS_PER_HOUR` → `429 { error: "too-many-starts", retryAt }` and `/start` page `data-error="too-many-starts"`, no job, no event. Known gap: a cache hit still costs 1 GitHub call (resolve HEAD SHA) and is not limited here. Production config refuses `INNGEST_DEV` and needs `INNGEST_SIGNING_KEY`, `INNGEST_EVENT_KEY`, `INNGEST_SERVE_ORIGIN` (passed to `serve()` as `serveOrigin`). Return targets with CR/LF (raw or `%0d%0a`) → ignored. Non-numeric `x-ratelimit-reset` → now + 60 s. A forged event cannot choose the repo (the job row is used); `.`/`..` names refused before any request. 404 / 401 in `fetch-repo` → failed, no snapshot; cross-origin 301 → no request and no token sent there. |
| verify | ☑ pass | auto-run by hook, session 2be86b0e-bc7e-4351-a859-6ea093a20ae9, commit fdd8580aad7a0068370df4fa8f98bd72c185a8ce, log .claude/verify-runs/T005-fdd8580aad7a.log — pass |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | ☐ pass / ☐ fail | [what was reviewed vs. skipped, and why] |
| Full smoke suite still green (no regression) | ☐ pass / ☐ fail | |
| **Companion score (easy-verifier)** | ☐ pass / ☐ fail / ☐ N/A | [`overall` and `change_risk` as the tool returned them, the scope, the ref, and the absolute path of the verifier report after a literal `report:` label — e.g. "overall 86 (>= 80), change_risk pass, scope changes, ref `main...HEAD`, report: `/home/me/.easy-verifier-reports/kit/score_changes_20261028T0530Z.html`". The gate reads the path that follows `report:` and nothing else, so with no label, or a path that is absent, the row is unscored — write ☑ N/A instead. ☑ N/A with a reason when neither companion tool was run: the merge gate blocks on ☑ fail only, never on an absent or N/A row] |
| **UI: Visual regression (diff or verdict pasted)** | ☑ pass | Screenshots in `test-results/screenshots/` (git-ignored): `job-queued-*`, `job-running-*`, `job-done-*`, `job-failed-*`, `start-unsupported-*` at mobile/tablet/desktop. LLM-vision verdict (agent, on `job-failed-mobile`, `start-unsupported-mobile`, `job-running-desktop`, `job-queued-tablet`): the status text is the h1 and the main element; the failed state reads "Failed: rate-limited" / "The GitHub rate limit is used up. It resets at 1/1/2030, 7:00:00 PM; then try again." — no stack trace or raw JSON (the e2e also asserts the body has no `{` and no `Error:`); the unsupported page says "Only GitHub repos work for now" and shows `https://gitlab.com/o/n?<b>x</b>` as plain text — pass. No committed baseline for these screens (as in T003, screenshots are not diffed). |
| **UI: Design-system compliance (tokens/colors/typography verified)** | ☑ pass | Playwright computed-style check (`expectTokens` in `e2e/start-flow.e2e.ts`) on every status state: body background = `--color-bg`; h1 color = `--color-text`, font-family = `--font-family`, font-size = `--font-size-h1`, font-weight = `--font-weight-strong`; `.status-detail` color = `--color-text-muted`, font-size = `--font-size-body`; `main` padding-top = `--space-8`, padding-left = `--space-4`, max-width = `--content-max` — all 6 e2e tests passed. `bun scripts/check-tokens.ts` → `check-tokens: 0 color literals outside src/client/tokens.css` (new CSS uses only `var(--color-accent)` and `var(--color-text-muted)`). |
| **UI: Responsiveness at target viewports** | ☑ pass | 360×740, 768×1024, 1280×800 for each status screen and the unsupported-URL page: `scrollWidth <= viewport width` asserted at each. A 320-char URL at 360px wraps (`.long-text { overflow-wrap: anywhere }`), scrollWidth ≤ 360 — pass. Desktop: column held at `--content-max` (40rem) and centered. No overflow found. |

---

## Demonstration

> Anchors what this task delivered to an observable before/after pair. BEFORE has no `N/A` path:
> if the task changes executable code, BEFORE is a pasted, timestamped terminal capture taken
> **before any implementation commit exists**; if it does not (docs, templates, skill-instruction
> text), BEFORE is the **verbatim prior content** of what changed — a quoted excerpt, not a command.

**BEFORE**: captured on branch `T005-start-job` at `c152afa`, before any implementation commit. Command:
`bun <scratchpad>/before.ts` (calls `createApp(...).request()` in-process on the four T005 entry points),
then the guide's test filter `bun test start-ladder repo-url fetch-repo jobs`.

```
2026-11-12T08:50:32Z
GET /start?url=https://github.com/lukeed/dset -> 404
POST /api/start -> 404
GET /api/jobs/00000000-0000-0000-0000-000000000000 -> 404
GET /jobs/00000000-0000-0000-0000-000000000000 -> 404
bun test v1.4.3 (c6da4a4d3)
The following filters did not match any test files in --cwd="/home/thunderkds/workspace/pets/wt-t005":
 start-ladder repo-url fetch-repo jobs
10 files were searched [2.00ms]
```

**AFTER**: same command at `879c022`. One change to the script: `loadConfig` now requires `GITHUB_APP_TOKEN`, so the
copy adds `GITHUB_APP_TOKEN: "x"` (the unchanged script now stops with `missing required environment variable(s):
GITHUB_APP_TOKEN`). Requests are signed out, as in BEFORE.

```
2026-11-12T09:10:10Z
GET /start?url=https://github.com/lukeed/dset -> 302
POST /api/start -> 401
GET /api/jobs/00000000-0000-0000-0000-000000000000 -> 401
GET /jobs/00000000-0000-0000-0000-000000000000 -> 302
bun test v1.4.3 (c6da4a4d3)
 55 pass
 0 fail
Ran 55 tests across 4 files. [937.00ms]
```

**DELTA**: A learner can now open `/start?url=<GitHub repo>`, sign in if needed, and land on `/jobs/:jobId`, which shows `Queued` → `Reading the repo` → `Done` (or `Failed: rate-limited` with the reset time) while a background job pins the SHA and stores the repo snapshot and confidence; before, all four entry points answered 404.

**WITNESS**: [who ran it and when — derived from `memory/event-trace/Txxx.jsonl`, never the
implementing agent alone]
