# TASK_GUIDE — T018: Deploy v1 + Gate 2 metrics ("others finish L1 without help")
**Date**: 2026-11-01
**Complexity Level**: C2
**Risk Level**: Medium
**Priority**: P1
**Assigned agent**: common-infrastructure
**Agent guide**: `agents/common-infrastructure.md`

---

## Mandatory Startup (Do Not Skip)

Before writing any code:
1. Read `PROJECT_SPEC.md`
2. Read the memory slice in your spawn prompt (`<!-- memory-slice -->`). Read `memory/MEMORY.md` in full only if your work reaches a file, hook, skill or decision the slice does not cover
3. Read this file completely
4. Read `agents/common-infrastructure.md`
5. Note the **Complexity Level** above and apply the matching process from the Complexity matrix in `agents/common-infrastructure.md`
6. C2: read `memory/codebase-map.md` (the app layout set by T003). Read `docs/REQUIREMENT_SOURCE.md` § Roadmap and § Diagram text "Roadmap", § Framework stack (row "Durable workflow": "runs on your existing deployment, no worker cluster"), § Architecture, § Alternatives to investigate (rows "Durable execution", "Client"); `PRD.md` § Success Metrics / KPIs (Gate 2 row); `docs/MAIN_FLOW.md` § 1.

---

## Requirement (Pillar 1 — Adapt the requirement)

Source:
- `docs/REQUIREMENT_SOURCE.md` § Diagram text "Roadmap": "v1 MVP PWA: About 4 to 6 weeks; URL to ladder, review; pass tests, offline, push." "Gate 2: Others finish L1 without your help."
- § Roadmap: "A failed gate triggers the pivots listed in the grill."
- § Framework stack, row "Durable workflow": "Inngest — Each step is checkpointed ... runs on your existing deployment, no worker cluster".
- § Architecture: "Independence test: delete either app and the other still works. No shared database, login or API between them."
- `PRD.md` § Success Metrics / KPIs: "Gate 2 (after v1) — other learners finish L1 without help — v1 usage".
- `PROJECT_SPEC.md` § Project Identity: "Deployment target: none yet (v1 decides)".

**Restated intent** (Supervisor's interpretation):
> Deploy the merged v1 app (T003–T017) to the hosting target the user picks, with Postgres + pgvector, Inngest, GitHub OAuth and push working over HTTPS. Then make Gate 2 measurable: a read-only script counts learners other than the owner who passed L1 and said no one helped them.

**Out of scope** (what this task explicitly does NOT do):
- Deciding whether Gate 2 passed (the user reads the numbers and decides; a fail triggers the grill pivots).
- Release notes and the rollback plan document (`Skill({ skill: "ship" })` produces them at Stage 5).
- Third-party analytics or tracking scripts.
- Any link, login or database shared with Idea Radar (T023 owns the `/start?url=` contract).
- Custom domain purchase (uses the host's default domain unless the user gives one).

**Requirement Refs** (FR/NFR/US IDs from `PRD.md` this task satisfies):
- NFR-001: the deployed API answers ladder requests in milliseconds; generation runs in the background
- NFR-003: GitHub OAuth works in production; artifacts bound to the signed-in account
- NFR-005: Inngest durable steps run in production
- NFR-007: progress syncs to the production backend
- FR-014: offline PWA and push work on the deployed HTTPS origin
- PRD § Success Metrics, Gate 2 row (no FR ID)

### Decision needed from the user

**Question**: Where should v1 run?

| Option | Hosting | Trade-off |
|---|---|---|
| A — Serverless platform + managed services | App on a serverless host that fits the web framework chosen in T003 (e.g. Vercel); managed Postgres with pgvector (e.g. Neon or Supabase); Inngest Cloud. | Least ops; free tiers likely cover v1 traffic; three vendors and three dashboards; cold starts. |
| B — One container host + managed Postgres | App as one container on a platform such as Fly.io, Railway or Render; managed Postgres with pgvector; Inngest Cloud. | One app runtime, no function time limits; small monthly cost; still a managed DB vendor. |
| C — One VPS, all self-hosted | One VPS with Docker Compose: app, Postgres + pgvector, self-hosted Inngest server, Caddy for HTTPS. | Lowest vendor count and full control; the owner runs backups, upgrades and TLS. |

Supervisor recommendation: A if T003 chose a framework the serverless host supports natively, else B. **The agent stops with `Status: blocked` + `Question:` until the user answers.** The user also confirms the monthly spend limit for the chosen host before the first deploy.

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [ ] Restated intent confirmed to match the user's request (by Supervisor / user — not the implementing agent)
- [ ] Domain terms align with `PROJECT_SPEC.md` glossary (`grill-with-docs` run if terminology was fuzzy)
- [ ] Every Acceptance Criterion below traces to a line in the Requirement
- [ ] All Requirement Refs exist in `PRD.md` and are fully covered by the Acceptance Criteria above

> An agent must NOT start implementing until this gate is checked. If anything here is unclear,
> STOP and ask the Supervisor (Karpathy: Think Before Coding).

---

## Dependencies & Reachability

**Depends on**: T003, T004, T005, T006, T007, T008, T009, T010, T011, T012, T013, T014, T015, T016, T017 — every v1 task must be Done before deploy; reasons:; T030 — the pass-test screens ship in v1
- T003 — app scaffold, migrations, GitHub OAuth, CI (the thing deployed)
- T004 — golden set and eval harness (the prompt-regression check run before deploy)
- T005 — `/start?url=` and the Inngest background job
- T006 — repo reader agent
- T007 — concept mapper
- T008 — level generators and answer-key check
- T009 — blind solver (needs model B's API key in production)
- T010 — ladder view
- T011 — daily review and review log
- T012 — MCQ pass test and evidence records
- T013 — GitHub artifact verifiers (L1 pass rule; the L1 evidence record that Gate 2 counts)
- T014 — diff questions
- T015 — service worker, push (needs VAPID keys and HTTPS in production)
- T016 — question flag
- T017 — cost cap value (set in production config)

**Entry point**: `pnpm metrics:gate2` (script) and `pnpm smoke:prod` (script); `Did anyone help you pass this level?` (prompt label shown after an L1 pass)

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | The app runs on the chosen host over HTTPS. All migrations are applied to the production database after `Skill({ skill: "migration-safety" })` passes and after a database backup is taken; `pgvector` is enabled. | "v1 MVP PWA ... URL to ladder, review; pass tests, offline, push" |
| 2 | Secrets (database URL, GitHub OAuth client secret, GitHub app token, model A and model B API keys, Inngest signing and event keys, VAPID private key, the T017 cost cap) live only in the host's secret store; `git grep` finds none of them in the repo, and the client bundle contains none except the VAPID public key and the OAuth client id. | secrets never committed (PROJECT_SPEC § Critical Constraints) |
| 3 | `pnpm smoke:prod` against the production URL passes: health check reports database and Inngest reachable; sign-in redirects to GitHub OAuth with the production callback; `/start?url=https://github.com/lukeed/dset` answers 202 with a job id (or the cached ladder) in < 500 ms; the service worker and manifest are served; a test push reaches the owner's subscribed device. | NFR-001, NFR-003, NFR-005, FR-014 |
| 4 | After an L1 pass, the learner sees one optional prompt `Did anyone help you pass this level?` with `No, on my own` / `Yes, I got help`; the answer is stored once per learner + ladder. Skipping stores nothing. | "Others finish L1 without your help" |
| 5 | `pnpm metrics:gate2` uses a read-only database role and prints: learners other than the owner (by GitHub id in `OWNER_GITHUB_ID`) who started a ladder; who passed L1 (an L1 evidence record); of those, answered "No, on my own" / "Yes" / no answer; median days from ladder start to L1 pass. No learner names or logins are printed, only counts. | Gate 2 "other learners finish L1 without help" |
| 6 | Negative: the owner's own L1 passes are never counted; a learner with an L1 pass but no answer is counted as "no answer", never as "on my own". The script run with a write-capable role fails at start. | Gate 2 "others", "without help" |
| 7 | Rollback is proven once: deploy a previous build and roll back to it on the host, and record the steps and time taken in the review. The app does not depend on Idea Radar at runtime (the deployed app works with Radar offline). | ship readiness; § Architecture independence test |

---

## Evaluation & Acceptance (How we know the agent worked correctly)

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | Test DB seeded with owner + 4 learners: 3 passed L1 (answers: no help, help, none), 1 started only | output: started 4, passed L1 3, on my own 1, got help 1, no answer 1; owner excluded | vitest (integration, test Postgres) |
| 2 | `metrics:gate2` with a role that has INSERT rights | exits non-zero with `role-not-read-only` | integration test |
| 3 | Help prompt answered twice for one ladder | one stored answer (the first) | integration test |
| 4 | Production URL | `pnpm smoke:prod` all checks pass | command run against production |
| 5 | Repo after deploy | `git grep` for each secret value returns nothing | command run |
| 6 | Rollback drill | previous build live, then current build live again; steps recorded | manual, recorded in review |

### Verification Command (exact, runnable)

```bash
# describe blocks of this task start with "T018"
pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test -- -t "T018" && pnpm exec playwright test --grep T018
# ci: skip — production checks: need the production URL, read-only DB role and the owner's push device
PROD_URL="$PROD_URL" pnpm smoke:prod && DATABASE_URL="$GATE2_READONLY_DATABASE_URL" pnpm metrics:gate2
```

### Evidence (filled by reviewer at Stage 4/5)

> **Moved.** Filled by the reviewer at Stage 4/5 in `tasks/TASK_REVIEW_T018.md`.

---

## Demonstration

> **Moved.** See `tasks/TASK_REVIEW_T018.md`.

---

## UI / Design Acceptance Criteria

> Each row must name a verification method and produce pasted evidence before Done (Hard-Stop Gate 6).

### 1. Visual Regression

| Screen / Component | Verification method | Expected result |
|-------------------|---------------------|-----------------|
| L1 help prompt (after an L1 pass) | Playwright screenshot at 360/768/1280 px + LLM-vision verdict with the rubric "one question, two answer buttons, a skip action, clearly optional, does not block the next level" | "matches spec" on all 3 viewports |
| Deployed app sign-in and ladder view (smoke) | Playwright screenshot of the production URL + LLM-vision verdict | same layout as the T010 baselines; no error page |

### 2. Design-System Compliance

| Criterion | Verification method | Expected result |
|-----------|---------------------|-----------------|
| Colors match design tokens | Playwright computed-style check on the prompt | colors resolve to the theme's CSS custom properties; no new hex literal in the diff (grep) |
| Typography matches spec | computed style | body ≥ 16 px; theme font stack |
| Spacing / layout matches spec | computed style | answer buttons ≥ 44 × 44 px tap target; ≥ 8 px gap |

### 3. Layout / Responsiveness

| Viewport | Verification method | Expected result |
|----------|---------------------|-----------------|
| Mobile (360px) | Playwright screenshot + `scrollWidth <= 360` | prompt full width; buttons stacked |
| Tablet (768px) | Playwright screenshot | buttons in one row |
| Desktop (1280px) | Playwright screenshot | prompt centred, max width kept |

---

## Approach

**Pattern reference**: T003's CI workflow and migration runner (reuse them for the production deploy, do not write a second runner); `experiments/core-spike/src/report.ts` — a script that prints counts with explicit known limits.

**Vital slice**: a working production deploy + `pnpm metrics:gate2` that counts others' L1 passes with the help answer.
**Cut list**:
- staging environment (one production environment; CI runs tests before deploy)
- custom domain
- uptime monitoring service (the host's built-in health check only)
- a metrics dashboard page (the script output is the Gate 2 report)

Order: backup → migrations (migration-safety gate) → deploy → register Inngest app with the production URL → update the GitHub OAuth app callback → `pnpm smoke:prod`. The help-prompt table is one new migration (learner id, ladder id, answer, answered_at; unique learner + ladder). `metrics:gate2` checks at start that the role cannot write (`has_table_privilege(... 'INSERT')` false on the evidence and help tables). The script's output ends with known limits: self-report can be wrong; "without help" is not observable by code. Hand the deployed facts (host, URLs, env var names, rollback steps) to the Supervisor for `Skill({ skill: "ship" })`; do not write the runbook here.

---

## Edge Case Checklist

- [ ] Serverless function time limit shorter than an Inngest step → steps stay within the host limit, or the host is option B/C (check before deploy)
- [ ] pgvector extension not available on the managed Postgres plan → stop before migrations and report
- [ ] GitHub OAuth callback still points to localhost → sign-in fails; smoke check catches it
- [ ] Service worker scope or HTTPS mixed content on the production origin → push and offline fail; smoke check covers manifest + SW
- [ ] Inngest signing key mismatch → events accepted but functions never run; smoke check waits for one job to reach `done`
- [ ] Owner signs in with a second GitHub account → counted as "other"; the report lists `OWNER_GITHUB_ID` values used
- [ ] Learner deletes their account → their rows leave the counts; the script reports current data only

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| host deploy config (file depends on the chosen host, e.g. `vercel.json`, `fly.toml` or `docker-compose.prod.yml`) | new |
| CI workflow from T003 | add deploy job after tests pass on `main` |
| `pnpm smoke:prod` script | new |
| `pnpm metrics:gate2` script | new |
| L1 help prompt component + its server handler | new |
| new migration (migrations folder set by T003) | help-answer table; read-only role grant |
| `.env.example` | add new env var names (no values) |
| tests (vitest, Playwright) | AC 4–6 |
| `tasks/TASK_REVIEW_T018.md` | Evidence (reviewer) |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `.claude/**`, `agents/**`, `skills/**`, `templates/**`, `AGENTS.md`, `CLAUDE.md` | kit |
| `PRD.md`, `PROJECT_SPEC.md`, `PROJECT_KANBAN.md` | Supervisor-owned (the Supervisor records the deployment target in `PROJECT_SPEC.md`) |
| `experiments/**` | throwaway spikes; read only |
| feature code of T005–T017 | deploy what is merged; a bug found goes back to the Supervisor as a bugfix |
| applied migrations of earlier tasks | never edit; add a new migration |
| any `.env` file with real values | secrets live in the host secret store only |

---

## Test Plan

Integration (vitest + test Postgres): `metrics:gate2` counts on seeded data, owner exclusion, "no answer" rule, read-only role check; help-answer uniqueness. E2E (Playwright, local): help prompt and the UI rows above. Production: `pnpm smoke:prod`, secret grep, rollback drill, one real push to the owner's device — outputs and timings pasted into the review. Paste `pnpm test` and Playwright output into the report.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run
- [ ] Security review: `Skill({ skill: "security-review" })` run (Medium risk)
- [ ] `Skill({ skill: "migration-safety" })` passed before the production migrations
- [ ] Lint passes (`pnpm lint`, `pnpm typecheck`)
- [ ] Tests written AND pass — output pasted into `tasks/TASK_REVIEW_T018.md` Evidence (Hard-Stop Gate 5)
- [ ] UI Evidence rows (visual regression, design-system compliance, responsiveness) filled with pasted evidence (Hard-Stop Gate 6)
- [ ] `Skill({ skill: "verify" })` run — headless auto verify
- [ ] Supervisor notified: task ready for Stage 4 review
