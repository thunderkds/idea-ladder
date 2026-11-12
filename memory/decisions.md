# decisions.md — Cold Tier: Architectural & Infrastructure Decisions

> **Rules**: Supervisor-only writes. Each entry: `### YYYY-MM-DD — Title`, then **Decision**, **Why**, and **Files** (cite paths — the diff-driven pass greps this file by changed file path).

## Architecture

### 2026-11-01 — v0 runs as experiments only (Option B, narrowed)
**Decision**: No product code before roadmap Gate 1. v0 = the ladder kit (T002) + a throwaway LLM-free spike (T001) measuring the answer-key code check, signed evidence proof and GitHub read against pre-registered thresholds. FSRS spike cut (v0 uses Anki's FSRS).
**Why**: User asked to "evaluate, experiment the solution before apply"; source roadmap says v0 is no-code. 2-Advocate Debate, auto mode, not yet approved by the user.
**Files**: BRAINSTORMING_LOG.md, experiments/core-spike/, experiments/v0-kit/, tasks/TASK_GUIDE_T001.md, tasks/TASK_GUIDE_T002.md
**Outcome (2026-11-01, merged to main)**: T001 — answer-key code check FAIL (catch 96.9%, false-reject 11.3% > 10%; borderline, seed by implementer) → v1 needs a blind solver or entailment check; signed proof KEEP (17/17 tamper rejected); GitHub read KEEP (7 calls/repo). User confirmed v0 repos PocketFlow / mitt / dset. See experiments/core-spike/RESULTS.md.

### 2026-11-01 — Phase plan T003–T030
**Decision**: v1 = T003–T018 + T030 (19 tasks), v2 = T019–T024, v3 = T025–T029; full guides for every phase (user). Accounts from day one (GitHub OAuth, Postgres); Claude = model A, second provider = model B; cost cap set in T017 after measurement. Each phase is blocked by its roadmap gate.
**Why**: user answers 2026-11-01; roadmap gates (docs/REQUIREMENT_SOURCE.md § Diagram text).
**Files**: tasks/TASK_GUIDE_T003.md … tasks/TASK_GUIDE_T030.md, PROJECT_KANBAN.md, docs/PLAN_LOG.md, PRD.md

### 2026-11-12 — Four source conflicts settled (user)
**Decision**: User agreed to all four suggested readings in `docs/MAIN_FLOW.md` § 5. C1: FSRS wins over the fixed 1/3/7/21-day intervals. C2: v1 uses plain signed JSON; Open Badges 3.0 waits for v2. C3: "5 minutes" means review only; a level's learn step is 20 to 30 min. C4: T025 may start once Gate 3's "proof links get shared" part passes; the outside-PR part is checked after T025.
**Why**: These were self-contradictions in the requirement source; v1 tasks T011, T019 and T025 depend on them.
**Files**: docs/MAIN_FLOW.md, tasks/TASK_GUIDE_T011.md, tasks/TASK_GUIDE_T019.md, tasks/TASK_GUIDE_T025.md

### 2026-11-12 — v1 stack: Bun, React, Postgres + pgvector; Claude subscription for lesson generation
**Decision**: Server and tooling on Bun (runtime, package manager, `bun test`; replaces Node, pnpm and vitest in the v1 plan). Client in React, built with Vite as a PWA. Database stays Postgres + pgvector. Vercel AI SDK and Inngest stay. Model A generation goes through one `generate` interface with two back ends: `claude-code` (headless `claude -p` on the owner's Claude subscription) while only the owner starts generations, and `api` (API key) before any other learner does (T018 / Gate 2). Model B and embeddings always use API keys: the subscription is Claude only, and model B must be a different provider.
**Why**: User choice 2026-11-12 ("Bun for BE, React base for FE, Postgres and pgvector, using the Claude subscription to generate the lesson if possible"). The subscription limit is the Supervisor's reading that subscription sign-in is for the owner's own use; check Anthropic's current terms before relying on it. Open risk: Inngest on Bun is not proven (T003 smoke check).
**Files**: PROJECT_SPEC.md, tasks/TASK_GUIDE_T003.md, tasks/TASK_GUIDE_T008.md, tasks/TASK_GUIDE_T009.md, tasks/TASK_GUIDE_T017.md. The other open guides (T004–T007, T010–T016, T018–T030) got the same command swap on 2026-11-12 (pnpm → bun, vitest → bun test, pnpm exec → bunx); T001 and T002 are done and unchanged.
**Audit (2026-11-12)**: T006's tool loop is API-only (`ANTHROPIC_API_KEY`); `generate` is created in T007 and reused by T008 and T014; T008 extends the T004 cost logger with `usd: null` for the `claude-code` back end; T017 exempts that back end from `missing-price`; T018 recommends a container host and requires `MODEL_A_BACKEND=api` in production; T012, T013 and T019 also mock `generate`. Applied on the Supervisor's recommendation after the user said to carry on; the user had not answered the API-only question in words.

### 2026-11-12 — Gate 1 waived: v1 starts now
**Decision**: The user waived Gate 1 ("let start the tasks already") before the 14-day v0 run finished. v1 tasks may start; first picks are T003 (scaffold) and T004 (golden set), which are P0 and independent. Gate 2 (v2) and Gate 3 (v3) still apply. Stage 0.5 approval of BRAINSTORMING_LOG.md is still not recorded.
**Why**: Explicit user instruction. Risk the user accepted: v1 may be built on a v0 result (usable ladders, daily review habit) that has not been measured.
**Files**: PROJECT_SPEC.md, PRD.md, PROJECT_KANBAN.md, tasks/TASK_GUIDE_T003.md, tasks/TASK_GUIDE_T004.md

### 2026-11-12 — T004 merged: golden set and eval harness
**Decision**: 20 golden repos (7 trending, 7 medium, 6 lowkey; 5 score `low` confidence), offline replay fixtures, scorers and a cost logger live under `eval/` as their own Bun package. Tier is set by stars in the fixture (trending ≥ 5,000; medium 500–4,999; lowkey < 500). Concept overlap = Jaccard on normalised slugs. Baseline T006 must beat: mean recall 0.06, precision 0.19 on core files; concept overlap 0.01. Open: `logStepCost` has no `usd: null` for the `claude-code` back end (T008 adds it); labels for 15 of 20 repos rest on README + file list + declarations, not full source; owner spot check not done.
**Why**: T004 acceptance criteria; auto verify pass 2026-11-12 (commit 082092d); Stage 4 code-review 0 P0/P1.
**Files**: eval/, tasks/TASK_GUIDE_T004.md, tasks/TASK_REVIEW_T004.md

### 2026-11-12 — T003 merged: v1 app scaffold
**Decision**: Server = Hono 4.13.13 on `Bun.serve` (own choice after comparing plain `Bun.serve` and Elysia). Migrations = own ~100-line SQL runner on Bun's built-in `SQL` client (`NNNN_name.up.sql` / `.down.sql`, one transaction per file, advisory lock); `db:migrate:down` refuses unless `MIGRATE_ALLOW_DOWN=1` and always refuses when `NODE_ENV=production`. Auth = hand-written GitHub OAuth (`read:user`, signed state cookie with 10-minute expiry, sessions in Postgres storing only an HMAC of the token; the GitHub access token is discarded). Client = React + Vite. Bun smoke check passed: an Inngest step served by `inngest/hono` called AI SDK `generateText` against a local stub (a real provider and Inngest Cloud signing are not proven). Details: docs/decisions/0001-web-framework.md.
**Why**: T003 acceptance criteria; auto verify pass 2026-11-12 (commit b688b44); Stage 4 reviews: 0 P0, security P1 (unguarded down migration) fixed. Open for T018: CSP header, `__Host-` cookie names, delete the old session on re-login, build the client before `start`, `CREATE EXTENSION vector` needs superuser on managed hosts, real-GitHub sign-in not yet run (needs the owner's OAuth app in `.env`), `.github/workflows/ci.yml` never ran on GitHub (no remote).
**Files**: src/server/, src/client/, migrations/, .github/workflows/ci.yml, docs/decisions/0001-web-framework.md, tasks/TASK_GUIDE_T003.md, tasks/TASK_REVIEW_T003.md

## Infrastructure

### 2026-11-01 — Idea Ladder uses board mode local
**Decision**: The repo arrived with another project's Linear config (team HUN, project "") and board cache. Moved `.claude/board.json` → `.claude/board.linear.json.bak` and the cache + 149 HUN guides → `docs/archive/easy-personal-board/` (git-ignored). New local `PROJECT_KANBAN.md` with T-IDs. No Linear writes.
**Why**: Hard-Stop Gate 4 (one project per KANBAN); online pull would erase local rows. 2-Advocate Debate. Undo: restore the .bak, then `python3 scripts/board_sync.py pull`.
**Files**: .claude/board.linear.json.bak, PROJECT_KANBAN.md, docs/archive/easy-personal-board/, .gitignore
