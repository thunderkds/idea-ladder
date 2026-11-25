# TASK_GUIDE — T034: Local dev sign-in — run the app on one machine without a GitHub OAuth app
**Date**: 2026-11-25
**Complexity Level**: C2
**Risk Level**: Medium
**Priority**: P1
**Assigned agent**: backend-developer
**Agent guide**: `agents/backend.md`

---

## Mandatory Startup (Do Not Skip)

Before writing any code:
1. Read `PROJECT_SPEC.md`
2. Read the memory slice in your spawn prompt (`<!-- memory-slice -->`). Read `memory/MEMORY.md` in full only if your work reaches a file, hook, skill or decision the slice does not cover
3. Read this file completely
4. Read `agents/backend.md`
5. Note the **Complexity Level** above and apply the matching process from the Complexity matrix in `agents/backend.md`
6. C2: read `memory/codebase-map.md`. Read `tasks/TASK_GUIDE_T003.md` (sign-in, sessions, config) and `src/server/auth.ts`, `src/server/github.ts`, `src/server/config.ts`, and the `/auth/github` routes in `src/server/app.ts`.

---

## Requirement (Pillar 1 — Adapt the requirement)

Source: the owner, 2026-11-25: "for the authen, we just need the session secret only, the github client id, and client secret is no need … github token and secret is fine, but remove 2 of another github". Today `loadConfig` requires `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` (a GitHub OAuth app), even for one person on one machine.

**Restated intent** (Supervisor's interpretation):
> The owner sets one variable, `DEV_LOGIN_GITHUB_LOGIN=<their GitHub username>`, and runs the app in development mode. Every sign-in path signs the owner in as that GitHub account, with no OAuth app. The app still has the real numeric GitHub id of that account, so ownership and the author check of L2/L4 proofs (NFR-003) work as today. `GITHUB_APP_TOKEN` and `SESSION_SECRET` stay required. `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are required only when `DEV_LOGIN_GITHUB_LOGIN` is not set. The real OAuth path stays in the code and keeps its tests.

**Out of scope**:
- Removing or changing the OAuth path, the `users` or `sessions` schema, or any migration.
- A second user, a user switcher, or a login form in the client.
- Any dev login outside `NODE_ENV=development` (tests use their own config, see AC 6).
- Hosting and deploy (T018).

**Requirement Refs**:
- NFR-003: every artifact belongs to the GitHub account signed in
- US-003 / FR-007: proof of authorship by the commit author id

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [x] Restated intent confirmed to match the user's request (by Supervisor / user — not the implementing agent) — Supervisor 2026-11-25: user answered "yes, github token and secret is fine, but remove 2 of another github" to the dev sign-in proposal
- [ ] Domain terms align with `PROJECT_SPEC.md` glossary
- [ ] Every Acceptance Criterion below traces to a line in the Requirement
- [ ] All Requirement Refs exist in `PRD.md` and are fully covered by the Acceptance Criteria above

> An agent must NOT start implementing until this gate is checked. If anything here is unclear,
> STOP and ask the Supervisor (Karpathy: Think Before Coding).

---

## Dependencies & Reachability

**Depends on**: T003 — sign-in, sessions, `loadConfig` (merged).
**Entry point**: `devLoginUser` (new `src/server/dev-login.ts`), called by `GET /auth/github` in `src/server/app.ts`

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | New optional variable `DEV_LOGIN_GITHUB_LOGIN`: a valid GitHub login (1–39 characters, letters, digits and single hyphens, not starting or ending with a hyphen). A bad value is a `ConfigError` that names the variable and does not print the value. | restated intent |
| 2 | **Production guard.** `loadConfig` throws a `ConfigError` naming `DEV_LOGIN_GITHUB_LOGIN` when it is set and `NODE_ENV` is anything other than `development` (production, unset, test, any other value). `main.ts` start-up therefore fails before it listens. `secureCookies` is unchanged. | "no bypass in production" |
| 3 | `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are required only when `DEV_LOGIN_GITHUB_LOGIN` is unset. When it is set and they are also set, the dev login wins and the OAuth variables are ignored. `GITHUB_APP_TOKEN` and `SESSION_SECRET` stay required in both modes. | restated intent |
| 4 | `GET /auth/github` with dev login set does not redirect to GitHub. It looks up the account with `GET /users/<login>` on `githubApiBaseUrl` using `GITHUB_APP_TOKEN`, takes the numeric `id` and the canonical `login` from the answer, calls the existing `signInUser`, sets the session cookie like the callback does and redirects to the validated `next` path (default `/ladders`). The existing `/auth/github?next=…` redirects in the other routes work with no change. | NFR-003 |
| 5 | The account lookup fails closed: an unknown login (404), a rate limit, a network error, a bad answer (no positive integer `id`, no string `login`) or a login in the answer that differs from the configured one (case-insensitive) gives the existing sign-in failure page (400), sets no cookie and creates no user. The failure log line has no token. | fail closed |
| 6 | With dev login **unset** the OAuth path behaves exactly as before: all T003 sign-in tests pass without change. Tests for dev login build their config with `NODE_ENV=development` and a stub GitHub API. | no regression |
| 7 | The ownership key stays the numeric GitHub id from the lookup: signing in twice reuses one `users` row; the id (not the login string typed in `.env`) is what `signInUser` stores. A test shows the L2/L4 author check reads the same user id as a normal sign-in. | NFR-003 |
| 8 | `docs/LOCAL_RUN.md` is updated: the OAuth steps become "optional", the variables table shows `DEV_LOGIN_GITHUB_LOGIN` and the required set for local use (`DATABASE_URL`, `GITHUB_APP_TOKEN`, `SESSION_SECRET`, `DEV_LOGIN_GITHUB_LOGIN`), and the production guard is stated. If `.env.example` is readable, add the variable there with an empty value and a one-line comment. | docs |

---

## Evaluation & Acceptance (How we know the agent worked correctly)

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | env with `NODE_ENV=development`, `DEV_LOGIN_GITHUB_LOGIN=octocat`, no OAuth variables | `loadConfig` succeeds | unit test |
| 2 | same env with `NODE_ENV=production`, `test`, or unset | `ConfigError` naming `DEV_LOGIN_GITHUB_LOGIN` | unit test |
| 3 | no dev login and no `GITHUB_CLIENT_ID` | `ConfigError` names `GITHUB_CLIENT_ID` (as today) | unit test |
| 4 | dev login, stub GitHub API returns `{ id: 583231, login: "octocat" }` | `GET /auth/github?next=/ladders/1` gives 302 to `/ladders/1`, a session cookie, one `users` row with `github_id = 583231`; then `/api/me` gives `{ login: "octocat" }` | integration test (real Postgres, stub API) |
| 5 | stub returns 404, or `{ id: "x" }`, or a different login | 400 failure page, no cookie, no user row | integration test |
| 6 | dev login set and the stub is never called when `GITHUB_APP_TOKEN` header is checked | the lookup sends `authorization: Bearer <GITHUB_APP_TOKEN>` | integration test |
| 7 | dev login unset | `/auth/github` redirects to `githubOauthBaseUrl` as before | existing T003 tests |

### Verification Command (exact, runnable)

```bash
# describe blocks of this task start with "T034"
bun install --frozen-lockfile && bun run typecheck && bun run lint && bun test -t "T034" && bun test -t "T003"
```

> Run tests only against the local Docker database: `DATABASE_URL=postgres://postgres:postgres@localhost:54329/idea_ladder`. Never against another server.

### Evidence (filled by reviewer at Stage 4/5)

> **Moved.** Filled by the reviewer at Stage 4/5 in `tasks/TASK_REVIEW_T034.md`.

---

## Approach

**Pattern reference**: `src/server/github.ts` (`fetchGithubUser`: timeouts, id and login checks, no token kept) and the `/auth/github/callback` handler in `src/server/app.ts` (cookie and return path). Reuse `signInUser` and `returnPath`; do not copy them.

**Vital slice**: config guard (AC 1–3), then the one route change (AC 4–5), then tests and the doc.
**Cut list**: a login form, a user switcher, a second dev user, any client change, removing OAuth.

Keep the change small: one new file `src/server/dev-login.ts` (lookup function and the login check), a few lines in `config.ts` and `app.ts`. Make `githubClientId` and `githubClientSecret` empty strings in the dev login mode, not optional types, so no other file changes. The OAuth routes must never run in dev mode with empty values: `/auth/github` takes the dev branch first and `/auth/github/callback` answers the failure page when dev login is set.

---

## Edge Case Checklist

- [ ] `DEV_LOGIN_GITHUB_LOGIN` set to an empty string → treated as unset
- [ ] `NODE_ENV` unset → `ConfigError` (not a silent dev login)
- [ ] The login in `.env` has different letter case than GitHub's canonical login → accepted; the canonical login from GitHub is stored
- [ ] GitHub returns the same account for a renamed login → the numeric id keeps the one `users` row
- [ ] A direct call to `/auth/github/callback` with dev login set → 400 failure page, no OAuth call
- [ ] The log never prints `GITHUB_APP_TOKEN`, `SESSION_SECRET` or the response body

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| `src/server/dev-login.ts` (new) | `devLoginUser(config)`: account lookup, checks, returns `GithubUser` |
| `src/server/config.ts` | `devLoginGithubLogin`, production guard, OAuth variables conditional |
| `src/server/app.ts` | dev branch in `GET /auth/github`; callback refuses in dev mode |
| `tests/` (describe blocks start with "T034") | AC 1–7 |
| `docs/LOCAL_RUN.md` | AC 8 |
| `.env.example` | only if readable |
| `tasks/TASK_REVIEW_T034.md` | Evidence (reviewer) |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `.claude/**`, `agents/**`, `skills/**`, `templates/**`, `AGENTS.md`, `CLAUDE.md` | kit |
| `PRD.md`, `PROJECT_SPEC.md`, `PROJECT_KANBAN.md` | Supervisor-owned |
| `src/server/auth.ts`, `src/server/github.ts` | consume only (`signInUser`, OAuth path stay as they are) |
| `src/client/**`, `migrations/**` | no UI, no schema |

---

## Test Plan

Unit (bun test): `loadConfig` cases (SC 1–3). Integration (real Postgres, stub GitHub API on a local port, real `createApp`): SC 4–6, then SC 7 through the existing T003 tests. Paste output into the report.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run
- [ ] Security review: `Skill({ skill: "security-review" })` run (Medium risk; this is an authentication bypass guarded by `NODE_ENV`)
- [ ] Lint passes (`bun run lint`, `bun run typecheck`)
- [ ] Tests written AND pass — output pasted into `tasks/TASK_REVIEW_T034.md` Evidence (Hard-Stop Gate 5)
- [ ] `Skill({ skill: "verify" })` run — headless auto verify
- [ ] Supervisor notified: task ready for Stage 4 review
