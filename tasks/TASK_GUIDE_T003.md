# TASK_GUIDE — T003: Scaffold — TypeScript app, Postgres + pgvector, migrations, GitHub OAuth sign-in, CI
**Date**: 2026-11-01
**Complexity Level**: C2
**Risk Level**: Medium
**Priority**: P0
**Assigned agent**: common-infrastructure
**Agent guide**: `agents/common-infrastructure.md`

---

## Mandatory Startup (Do Not Skip)

Before writing any code:
1. Read `PROJECT_SPEC.md`
2. Read the memory slice in your spawn prompt (`<!-- memory-slice -->`). Read `memory/MEMORY.md` in full only if your work reaches a file, hook, skill or decision the slice does not cover
3. Read this file completely
4. Read `agents/common-infrastructure.md`
5. Note the **Complexity Level** above and apply the matching process from the Complexity matrix in `agents/common-infrastructure.md` (C2 with >1 viable framework → `Skill({ skill: "brainstorming" })` before any code)
6. C2: no app exists yet, so `memory/codebase-map.md` covers only the kit and `experiments/` — skim it, do not rely on it for app layout. Read `docs/REQUIREMENT_SOURCE.md` § Framework stack, § Proof architecture (Identity binding row), § Architecture, and `docs/MAIN_FLOW.md` § 1–2.

---

## Requirement (Pillar 1 — Adapt the requirement)

Requirement § Framework stack: "TypeScript end to end: Vercel AI SDK for model calls, Inngest for durable
steps, Postgres with pgvector for everything stored." § Proof architecture, Identity binding: "Learner signs
in with GitHub OAuth; every artifact must belong to that GitHub account". User decision 2026-11-01 (PRD Open
Question 4): "accounts from day one (GitHub OAuth; progress, reviews, evidence in Postgres)". § Grill #11:
"iOS clears PWA storage? … sync to backend".

**Restated intent** (Supervisor's interpretation):
> Stand up the one v1 app every later task builds on: a TypeScript web app (framework chosen in this task by
> brainstorm), Postgres + pgvector with reversible migrations, GitHub OAuth sign-in, and CI. The tracer bullet
> is: a learner signs in with GitHub and sees an empty "My ladders" page.

**Out of scope** (what this task explicitly does NOT do):
- Inngest, Vercel AI SDK, GitHub repo reading (T005 onward).
- PWA manifest, service worker, push (T015).
- Any ladder, progress, review or evidence table beyond `users` and `sessions` (each later task adds its own migration).
- Hosting / deploy target (T018, HITL). The scaffold must not lock the app to one host.
- Sign-in methods other than GitHub; account deletion; profile page.

**Requirement Refs**:
- NFR-003: every artifact belongs to the GitHub account signed in by OAuth (identity binding foundation)
- NFR-007: progress syncs to the backend (backend store exists from day one)
- PRD Open Question 4 (resolved): accounts from day one, Postgres

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [ ] Restated intent confirmed to match the user's request (by Supervisor / user — not the implementing agent)
- [ ] Domain terms align with `PROJECT_SPEC.md` glossary (`grill-with-docs` run if terminology was fuzzy)
- [ ] Every Acceptance Criterion below traces to a line in the Requirement
- [ ] All Requirement Refs exist in `PRD.md` and are fully covered by the Acceptance Criteria above

> An agent must NOT start implementing until this gate is checked. If anything here is unclear,
> STOP and ask the Supervisor (Karpathy: Think Before Coding).

---

## Dependencies & Reachability

**Depends on**: None
**Entry point**: `Sign in with GitHub` (button label on the signed-out home page) → route `/ladders` ("My ladders")

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | `pnpm db:migrate` on an empty Postgres creates the `vector` extension and the `users` (`id`, `github_id` unique, `github_login`, `created_at`, `updated_at`) and `sessions` tables. `pnpm db:migrate:down` reverts to an empty schema; running up again succeeds. | Postgres with pgvector; migrations |
| 2 | Signed out, `/` shows a `Sign in with GitHub` button. It redirects to GitHub's authorize URL with `client_id`, a random `state`, and scope `read:user` only (no `repo` scope). | GitHub OAuth sign-in |
| 3 | The OAuth callback with a valid `code` + `state` upserts the user by `github_id` (not by login), sets a session cookie (`HttpOnly`, `SameSite=Lax`, `Secure` outside local dev), and redirects to `/ladders`, which shows the heading `My ladders` and the empty state `No ladders yet`. | tracer: sign in, see empty "My ladders" |
| 4 | Negative: a callback with a missing or mismatched `state`, or a failed token exchange, returns 400 / an error page, creates no `users` row and sets no session cookie. | identity binding must not be forgeable |
| 5 | Boundary: the same GitHub account signs in twice after renaming its login → still one `users` row; `github_login` is updated. | "every artifact must belong to that GitHub account" |
| 6 | Signed out, `GET /ladders` redirects to `/` (302); after sign-out the old session cookie no longer opens `/ladders`. | accounts from day one |
| 7 | `.github/workflows/ci.yml` runs `pnpm install --frozen-lockfile`, typecheck, lint, unit tests, migrations up/down against a `pgvector` Postgres service, and the sign-in e2e test. `pnpm ci:local` runs the same steps locally and passes. | CI |
| 8 | Secrets: `.env.example` lists variable names only (`DATABASE_URL`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `SESSION_SECRET`); `.env*` except `.env.example` is git-ignored; `git grep` for the client secret value finds nothing. | PROJECT_SPEC Critical Constraints (never commit secrets) |

---

## Evaluation & Acceptance (How we know the agent worked correctly)

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | Empty `pgvector/pgvector` container | migrate up → `SELECT extname FROM pg_extension` includes `vector`; down → no app tables | automated test (migration test) |
| 2 | Stub GitHub OAuth server (test-only, via `GITHUB_OAUTH_BASE_URL` / `GITHUB_API_BASE_URL`) returns user `{ id: 42, login: "octo" }` | Playwright: click `Sign in with GitHub` → lands on `/ladders` with `My ladders` + `No ladders yet` | automated e2e |
| 3 | Callback with `state` that differs from the cookie | 400, `users` count unchanged, no `Set-Cookie` for the session | automated test |
| 4 | Stub returns `{ id: 42, login: "octo-renamed" }` on a second sign-in | one row with `github_id = 42`, `github_login = 'octo-renamed'` | automated test |
| 5 | No session cookie, `GET /ladders` | 302 to `/` | automated test |
| 6 | `pnpm ci:local` | exit 0 | command run |

### Verification Command (exact, runnable)

```bash
docker compose up -d db
pnpm install --frozen-lockfile
pnpm db:migrate && pnpm db:migrate:down && pnpm db:migrate
pnpm typecheck && pnpm lint && pnpm test
pnpm test:e2e -- sign-in
pnpm ci:local
```

### Evidence (filled by reviewer at Stage 4/5)

> **Moved.** Filled by the reviewer at Stage 4/5 in `tasks/TASK_REVIEW_T003.md`.

---

## Demonstration

> **Moved.** See `tasks/TASK_REVIEW_T003.md`.

---

## UI / Design Acceptance Criteria

> No design system exists yet. This task creates the first design tokens (CSS custom properties in one
> tokens file: colors, font family, type scale, spacing scale). Later UI tasks check against that file.

### 1. Visual Regression

| Screen / Component | Verification method | Expected result |
|-------------------|---------------------|-----------------|
| Signed-out home (`/`) | Playwright screenshot + LLM-vision verdict against this guide's AC 2 | one clear `Sign in with GitHub` button, app name visible, no layout overflow |
| `My ladders` empty state (`/ladders`) | Playwright screenshot + LLM-vision verdict against AC 3; baseline stored for later diffs | heading `My ladders`, text `No ladders yet`, signed-in GitHub login shown, sign-out control |

### 2. Design-System Compliance

| Criterion | Verification method | Expected result |
|-----------|---------------------|-----------------|
| Colors match design tokens | Playwright computed-style check: `color` / `background-color` of body, heading, button resolve to values defined in the tokens file | no hard-coded color outside the tokens file (lint/grep for hex literals in components = 0) |
| Typography matches spec | computed `font-family`, `font-size`, `font-weight` of `h1`, body text, button | values equal the tokens-file type scale |
| Spacing / layout matches spec | computed `padding` / `margin` of page container and button | values come from the tokens-file spacing scale |

### 3. Layout / Responsiveness

| Viewport | Verification method | Expected result |
|----------|---------------------|-----------------|
| Mobile (360px) | Playwright screenshot at 360×740 + LLM-vision verdict; `document.documentElement.scrollWidth <= 360` | button full-width or centered, no horizontal scroll, tap target ≥ 44px high |
| Tablet (768px) | Playwright screenshot at 768×1024 + LLM-vision verdict | content centered, no horizontal scroll |
| Desktop (1280px) | Playwright screenshot at 1280×800 + LLM-vision verdict | content in a readable max-width column, no horizontal scroll |

---

## Approach

**Pattern reference**: `None — no comparable prior art in this repo` (only the throwaway `experiments/core-spike`; copy its pinning discipline and vitest setup from `experiments/core-spike/package.json`, not its structure)

**Vital slice**: GitHub sign-in → session → empty `My ladders` page, on a migrated Postgres + pgvector, green in CI.
**Cut list**:
- Inngest and AI SDK wiring (T005 / T006 add them where first used)
- PWA manifest and service worker (T015)
- deploy config (T018)
- sign-in providers other than GitHub
- storing the GitHub OAuth access token (no task needs it yet; T013 decides if it does)
- account deletion and profile settings

1. Run `Skill({ skill: "brainstorming" })` for the web framework. Hard constraints: TypeScript; server routes for `/start?url=` and the OAuth callback; can host an Inngest serve handler and Vercel AI SDK calls; can ship a PWA (service worker) later; not tied to one host (T018 decides hosting). Compare at least 3 candidates (for example Next.js, SvelteKit, Hono + Vite SPA) on these constraints. Decide the migration tool and the OAuth/session approach in the same brainstorm. Write the decision and its reasons to `docs/decisions/0001-web-framework.md`; the Supervisor copies it to `memory/decisions.md`.
2. Use pnpm. Pin every dependency to an exact version published at least 2 weeks before 2026-11-01. Commit the lockfile.
3. Local Postgres: `docker-compose.yml` with a pinned `pgvector/pgvector` image tag.
4. OAuth: scope `read:user` only. `state` in a short-lived HttpOnly cookie, compared in constant time. Identity key = GitHub numeric `id`. Base URLs for GitHub OAuth/API come from env so tests use a local stub; production defaults are `https://github.com` / `https://api.github.com`.
5. Apply `Skill({ skill: "migration-safety" })` before applying the first migration (responsibility #4 in `agents/common-infrastructure.md`).
6. CI: this guide is the Supervisor's approval to create `.github/workflows/ci.yml` (Constraint "Never modify CI/CD … without explicit Supervisor approval"). The repo has no remote yet, so `pnpm ci:local` is the runnable proof.
7. After merge, the Supervisor runs `/map-codebase`; later guides read the layout from `memory/codebase-map.md`.

---

## Edge Case Checklist

- [ ] Callback replay: the same `code` + `state` used twice → second call fails, no second session
- [ ] `state` cookie expired (older than its max age) → 400
- [ ] GitHub returns an error query (`error=access_denied`) on the callback → friendly page, no session
- [ ] Login renamed on GitHub → matched by `github_id`, login updated (AC 5)
- [ ] Two different GitHub accounts → two rows; one cannot read the other's session
- [ ] `pnpm db:migrate:down` on a database with rows in `users` → documented behavior (drops; the migration-safety report states it); never runs in production without the T018 runbook
- [ ] `vector` extension missing on the server → migration fails with a clear message, not a half-applied schema (migration runs in one transaction)
- [ ] Missing env var at start → process exits with the variable name, not a stack trace from deep inside OAuth code

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, lint config | new app root (TypeScript, pnpm scripts `dev`, `build`, `typecheck`, `lint`, `test`, `test:e2e`, `db:migrate`, `db:migrate:down`, `ci:local`) |
| app source tree (layout set by the brainstorm decision) | home page, OAuth routes, session handling, `/ladders` page, tokens file |
| migrations directory (layout set by the chosen migration tool) | first migration: `vector` extension, `users`, `sessions` |
| `docker-compose.yml` | local `pgvector/pgvector` Postgres |
| `.env.example`, `.gitignore` | env names; ignore `.env*` |
| `.github/workflows/ci.yml` | CI (approved by this guide) |
| tests (unit + Playwright e2e) and a test-only GitHub OAuth stub | AC 1–7 |
| `docs/decisions/0001-web-framework.md` | brainstorm decision |
| `tasks/TASK_REVIEW_T003.md` | Evidence (reviewer) |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `.claude/**`, `agents/**`, `skills/**`, `templates/**`, `AGENTS.md`, `CLAUDE.md` | kit |
| `PRD.md`, `PROJECT_SPEC.md`, `PROJECT_KANBAN.md`, `BRAINSTORMING_LOG.md`, `memory/**` | Supervisor-owned |
| `experiments/**` | throwaway v0 spikes (T001, T002); do not import from them |
| `docs/archive/**` | another project's archived board |

---

## Test Plan

- Unit/integration (vitest): OAuth `state` check, callback handler with the stub, user upsert by `github_id`, session guard on `/ladders`, env validation.
- Migration test: up → assert extension + tables; down → assert empty; up again.
- e2e (Playwright, stub OAuth): sign-in tracer (AC 3), sign-out (AC 6), screenshots for the UI section at 360/768/1280 px.
- Real run: `pnpm dev`, sign in with a real GitHub OAuth app (owner's client id in `.env`), see `My ladders`. Paste the observation into the review file.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run
- [ ] Security review: `Skill({ skill: "security-review" })` run (Medium risk)
- [ ] Migration safety: `Skill({ skill: "migration-safety" })` run (first schema)
- [ ] Lint passes (`pnpm lint`, `pnpm typecheck`)
- [ ] Tests written AND pass — output pasted into `tasks/TASK_REVIEW_T003.md` Evidence (Hard-Stop Gate 5)
- [ ] `Skill({ skill: "verify" })` run — headless auto verify
- [ ] Supervisor notified: task ready for Stage 4 review
