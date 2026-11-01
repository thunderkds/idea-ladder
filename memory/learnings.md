# learnings.md — Cold Tier: Clarifications, Patterns & Gotchas

> **Rules**: Supervisor-only writes. Each entry dated (`YYYY-MM-DD`) and citing the file/task it came from (the diff-driven pass greps this file by changed file path).

## Requirement Clarifications

- 2026-11-01 — Requirement doc conflicts with itself in 3 places (fixed review days vs FSRS; OB 3.0 vs plain signed JSON in v1; 5-min review vs 20–30 min learn). Supervisor reading recorded in docs/MAIN_FLOW.md § 5; not yet confirmed by the user.
- 2026-11-01 — Idea Radar exists outside this repo and already sorts repos into trending/medium/lowkey (architecture diagram, docs/REQUIREMENT_SOURCE.md).

## Patterns

- **T015 push paths are shown only with mocks (2026-11-01).** No real delivery ran, and auto verify could not turn reminders on in headless Chromium. The first deploy (T018) must run one real push. Auto verify saw 2 sync runs leave ratings queued with a CDP session open; the cause was not proven.

- **web-push reads endpoints with the legacy URL parser (2026-11-01).** `new URL("https:host/x")` finds the host, but `url.parse` finds none, and `https.request` then goes to localhost. Check the raw string starts with `https://` as well as the parsed host.

- **T006 needs a new migration number at its merge (2026-11-01).** T006 and T011 both use `1762000002000`. Rename T006's file to a later number, or its migration runs out of order.
- **Cache-hit learners have no started record (2026-11-01).** `startLadder` writes no row on a hit, and `listMyLadders` and `getReviewQueue` read `generation_jobs.started_by`. Every learner after the first gets no My ladders row and no reviews. Fix before T008 saves real ladders.

- **Check the exit code of a frozen install (2026-11-01).** An agent can pin a dependency in `package.json` and leave a caret in the lockfile. Tests still pass in a worktree that has its packages. T010 merged this way; only the run on merged `main` caught it.

- **The merge gate checks the whole Bash command (2026-11-01).** A call that edits the board and merges is refused before anything runs. Move the row in one call and merge in the next. A row under Blocked does not hold the gate.

- **The repo reader needs a GitHub token in real use (2026-11-01).** T005 alone costs about 7 calls per repo, but T006 adds one call per file read and up to 30 per `search`. One job can pass the unauthenticated limit of 60 per hour.

- **T008 must match the columns T010 reads (2026-11-01).** `src/ladder/view.ts` reads `levels(ladder_id, level_id, goal, pass_test_kind, pass_test_description)` behind a `to_regclass` check. T008 uses those names or changes the view, and removes the check.

- **The step limit counts every agent of a task (2026-11-01).** `pre_agent_step_limit.py` counts by Task ID, so a reviewer spawned after a long build can be stopped after 3 calls. The T005 security reviewer was stopped this way. Treat that result as incomplete and rerun it; the counter resets itself.
- **An open job holds its repo + SHA until it fails (2026-11-01).** `generation_jobs_open_key` covers every status except `failed`. T005 leaves no way out for a job stuck `queued` or `running`, and T008 must handle `fetched` jobs that never produce a ladder.

- **Lint and the database on the main checkout (2026-11-01).** `pnpm lint` from `main` also walks `.claude/worktrees/`; T005 adds `.claude/` to the ESLint ignores. Worktree compose projects all bind port 54329: stop the other container first, and recreate one that failed its first start, because it comes up with no published port.
- **`security-review` needs `origin/HEAD` (2026-11-01).** This repo's remote is `github`, so the built-in skill stops at launch with `fatal: ambiguous argument 'origin/HEAD...'`. To run it: in the task worktree, `git update-ref refs/remotes/origin/HEAD main`, run the skill, then delete that ref.
- **The merge gate also blocks trial merges (2026-11-01).** Any `git merge` in a Bash call is blocked while a task is In Progress, even in a scratch worktree. Check overlap from `git diff --name-only` lists until the tasks are through review.
- **Two e2e runs at once collide (2026-11-01).** Every worktree's `pnpm test:e2e` uses port 4010 and the `il_e2e` database; `scripts/prepare-e2e-db.ts` rebuilds `il_e2e` even when the port is taken. Run e2e in one worktree at a time. (T032, T015)
- **`review_log` is append-only, so shared-DB test cleanup cannot `DELETE FROM cards` after a rating (2026-11-01).** A test that rates a card gets its own `startTestApp()`. (T032 `test/ladder-learners.test.ts`)
- **easy-verifier MCP cannot see worktrees (2026-11-01).** The registered server answers `target repository path does not exist` for paths under `~/workspace`: container `easy-verifier-mcp-scorer-1` mounts no workspace (`/EASY_VERIFIER_WORKSPACE-is-not-set`), and `easy-verifier` (which mounts it) was restarting. The operator fixes the container; the Companion score row is N/A until then. (T032)

- 2026-11-01 — Gate 5 trace check (`.claude/hooks/pre_bash_block_unsafe_merge.py` TEST_INVOCATION_PATTERN) counts `npm test` / `pnpm test` / pytest, not `node --test`; and the trace summary is truncated, so a long command line can hide the runner. Give every package a `test` script and run it as a short `cd <dir> && pnpm test`. (T001, T002; experiments/v0-kit/package.json)
- 2026-11-01 — Built-in `security-review` diffs against `origin/HEAD`; with no remote it fails. Work-around used: a temporary local `refs/remotes/origin/HEAD`, deleted after. (T001)
- 2026-11-01 — Kit `__pycache__/*.pyc` files are tracked, and hooks rewrite them, so worktrees show them modified. Restore with `git checkout -- <pyc>` before committing; never commit them. (.gitignore)

## Gotchas
