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

## Gotchas
