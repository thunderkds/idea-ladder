# learnings.md — Cold Tier: Clarifications, Patterns & Gotchas

> **Rules**: Supervisor-only writes. Each entry dated (`YYYY-MM-DD`) and citing the file/task it came from (the diff-driven pass greps this file by changed file path).

## Requirement Clarifications

- 2026-11-01 — Requirement doc conflicts with itself in 4 places (fixed review days vs FSRS; OB 3.0 vs plain signed JSON in v1; 5-min review vs 20–30 min learn; Gate 3 outside PR vs the repo built in v3). Settled 2026-11-12: user agreed to all four readings in docs/MAIN_FLOW.md § 5 (decisions.md).
- 2026-11-01 — Idea Radar exists outside this repo and already sorts repos into trending/medium/lowkey (architecture diagram, docs/REQUIREMENT_SOURCE.md).

## Patterns

- 2026-11-01 — Gate 5 trace check (`.claude/hooks/pre_bash_block_unsafe_merge.py` TEST_INVOCATION_PATTERN) counts `npm test` / `pnpm test` / pytest, not `node --test`; and the trace summary is truncated, so a long command line can hide the runner. Give every package a `test` script and run it as a short `cd <dir> && pnpm test`. (T001, T002; experiments/v0-kit/package.json)
- 2026-11-12 — The same pattern has no `bun test` / `bun run test`, so with the Bun stack decision (decisions.md) the Gate 5 hook would not see v1 test runs as verification and could block merges. Fixed 2026-11-12 on branch fix/gate5-bun-test: `bun` added to TEST_INVOCATION_PATTERN (`bun test`, `bun run test`); `bun run typecheck`, `bunx vitest` and `echo bun test` still do not count.
- 2026-11-01 — Built-in `security-review` diffs against `origin/HEAD`; with no remote it fails. Work-around used: a temporary local `refs/remotes/origin/HEAD`, deleted after. (T001)
- 2026-11-01 — Kit `__pycache__/*.pyc` files are tracked, and hooks rewrite them, so worktrees show them modified. Restore with `git checkout -- <pyc>` before committing; never commit them. (.gitignore)
- 2026-11-12 — Bun gotcha for the v1 guides: `bun test` is Bun's own runner and ignores the `test` script in package.json; Playwright e2e runs through `bun run test:e2e` / `bunx playwright`, never `bun test`. All open guides now use these commands (decisions.md 2026-11-12 v1 stack).
- 2026-11-12 — Bun test gotchas from T003: a Bun `SQL` tagged query is lazy, so `expect(sql`...`).rejects` hangs (wrap it in an async function); `bun test` also picks up `*.spec.ts`, so Playwright files are named `*.e2e.ts` and `bunfig.toml` sets the test root. First Playwright run after idle on WSL took 2.3 min (cold browser).
- 2026-11-12 — T004: GitHub search sorted by update returns mostly star-farming spam, so the golden repo list was curated by hand. A sub-agent's `security-review` skill run built its diff from the wrong base (planning docs, not the task): pass `base=` explicitly and check the diff header.
- 2026-11-12 — Sub-agents stop at 90 tool calls (`pre_agent_step_limit` hook): T005 needed two implementers and a resume. Spawn C2 tasks that touch server + client + e2e + CI with a split brief or an explicit budget; commit the WIP from the Supervisor side so nothing is lost. Implementer agents have no `Skill` tool, so code-review, security-review and migration-safety run from a general-purpose reviewer spawn or from the Supervisor. Reviewer spawns need the diff range stated (`main...<branch>`).
- 2026-11-12 — A sub-agent's `bun pm trust inngest-cli` was blocked by the auto-mode classifier (postinstall binary download). Do not work around it: run the Inngest function in-process with `@inngest/test`, and leave the real dev server to the owner (`npx --yes inngest-cli@1.46.0 dev`).

## Gotchas
