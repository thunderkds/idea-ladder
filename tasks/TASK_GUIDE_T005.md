# TASK_GUIDE — T005: /start?url= → read repo with token, pin SHA, cache by repo+SHA, background job (Inngest), status page
**Date**: 2026-11-01
**Complexity Level**: C2
**Risk Level**: Medium
**Priority**: P0
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
6. C2: read `memory/codebase-map.md` for the app layout set by T003 (if it is missing, ask the Supervisor to run `/map-codebase`). Read `docs/decisions/0001-web-framework.md` (T003), `docs/MAIN_FLOW.md` § 2, `docs/REQUIREMENT_SOURCE.md` § Architecture, § Repo to ladder engine, § Sequence: ladder generation, and `experiments/core-spike/RESULTS.md` § 3.

---

## Requirement (Pillar 1 — Adapt the requirement)

§ Architecture: "The only contract is `https://<ladder-app>/start?url=<repo or any URL>` … Idea Ladder accepts
URLs pasted by hand too." § Repo to ladder engine: "Read the repo from the GitHub API: README, topics,
languages, dependency files, open issues, `good first issue` labels. Pin to a commit SHA." "Score confidence:
thin README or no issues means low confidence; fall back to concept-only ladders." § Sequence: ladder
generation: "1 PWA→API POST /start · 2 API→Store look up ladder by repo + commit SHA · 3 Store→API hit: return
cached ladder, stop here · 4 API→Workflow miss: event · 5 API→PWA 202 + job id · 6 Workflow→GitHub tree,
README, deps". "The API answers in milliseconds; generation runs in the background and notifies the PWA when
done." § Framework stack: "Inngest — Each step is checkpointed; a failed LLM step retries alone"; "Ladders keyed
by repo + commit SHA". `docs/MAIN_FLOW.md` § 6: "Each app calls the GitHub API with its own token — v1 needs a
token".

**Restated intent** (Supervisor's interpretation):
> A signed-in learner opens `/start?url=<GitHub repo URL>`. The app resolves the repo's current commit SHA
> with its own GitHub token and returns at once: a cached ladder for that repo + SHA, or a new background
> generation job (Inngest) whose first step reads the repo snapshot and scores confidence. A status page shows
> the job's progress.

**Out of scope** (what this task explicitly does NOT do):
- Ladders from non-GitHub URLs (articles, docs): `/start` answers them with a clear "not supported yet" page; the any-URL source is a later task.
- The reader, concept mapper, generators, blind solver (T006–T009) — this task ships the workflow with only the fetch step, and the job ends in status `fetched`.
- Push notification when the ladder is ready (T015); the status page polls.
- The ladder view (T010).
- Private repos (the app token reads public repos only).

**Requirement Refs**:
- US-001: paste a repo URL or open `/start?url=` and get a ladder
- FR-001: read README, topics, languages, dependency files, open issues, `good first issue` labels; pin to a commit SHA
- FR-005: confidence score + concept fallback flag (computed in the fetch step)
- FR-015: the only contract with Idea Radar is `/start?url=`; hand-pasted URLs also work
- NFR-001: the API answers in milliseconds; generation runs in the background
- NFR-004: ladders cached by repo + commit SHA
- NFR-005: each workflow step durable and retried on its own
- NFR-009: GitHub rate limits → clear error, not a partial ladder

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [ ] Restated intent confirmed to match the user's request (by Supervisor / user — not the implementing agent)
- [ ] Domain terms align with `PROJECT_SPEC.md` glossary (`grill-with-docs` run if terminology was fuzzy)
- [ ] Every Acceptance Criterion below traces to a line in the Requirement
- [ ] All Requirement Refs exist in `PRD.md` and are fully covered by the Acceptance Criteria above

> An agent must NOT start implementing until this gate is checked. If anything here is unclear,
> STOP and ask the Supervisor (Karpathy: Think Before Coding).

---

## Dependencies & Reachability

**Depends on**: T003 — app scaffold, Postgres + migrations, GitHub OAuth session (the learner must be signed in)
**Entry point**: `GET /start?url=` (browser contract) and `POST /api/start` (JSON); status page `/jobs/:jobId`

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | `parseRepoUrl(input)` accepts `https://github.com/o/n`, `http://`, `www.`, trailing `/`, `.git`, `/tree/<ref>/<path>`, and `o/n` pasted alone → `{ owner, name }` (owner `^[A-Za-z0-9-]{1,39}$`, name `^[A-Za-z0-9._-]{1,100}$`). Any other host, scheme (`javascript:`, `file:`), or malformed path → `UnsupportedUrlError`; no network call is made for it. | `/start?url=<repo or any URL>`; hand-pasted URLs |
| 2 | `POST /api/start { url }` (signed in) resolves the default-branch HEAD SHA with one GitHub API call using the app token. Cache hit on `(repo_full_name, commit_sha)` → `200 { ladderId }`, no job and no Inngest event. Miss → `202 { jobId }` and one `ladder/generate.requested` event. The handler makes at most 1 GitHub call and no LLM call. | look up by repo + SHA; hit → return; miss → 202 + job id; answers in milliseconds |
| 3 | `GET /start?url=` signed out → redirect to sign-in, then back to the same `/start?url=` (only same-origin `/start` paths are accepted as the return target). Signed in → redirect to the ladder (hit) or `/jobs/:jobId` (miss). | the only contract with Idea Radar |
| 4 | Concurrency: two `POST /api/start` for the same repo + SHA at the same time → exactly one job and one event (unique constraint + insert-on-conflict); both callers get the same `jobId`. | first learner pays generation, later learners reuse |
| 5 | The Inngest function's step `fetch-repo` stores a snapshot (`sha`, `defaultBranch`, `readme`, `topics`, `languages`, `depFiles`, `openIssues`, `goodFirstIssues`, `tree`) for that SHA and a confidence result (`score`, `level`, `fallbackToConcepts`, `reasons[]`) using the T001 rule. Job status moves `queued` → `running` → `fetched`. | read README, topics, … ; pin to SHA; score confidence |
| 6 | Negative: GitHub 403/429 with `x-ratelimit-remaining: 0` → job status `failed`, reason `rate-limited`, with the reset time; no snapshot row is written (no partial ladder). Repo 404 at `/api/start` → `404 { error: "repo-not-found" }`, no job. | NFR-009 |
| 7 | `GET /api/jobs/:jobId` returns `{ status, reason?, ladderId? }` to the learner who started it or any signed-in learner waiting on the same repo + SHA; unknown id → 404. `/jobs/:jobId` shows status text (`Queued`, `Reading the repo`, `Done`, `Failed: <reason>`) and polls until a final status. | status page; notifies the PWA when done |
| 8 | Retry: when the step throws a transient error (5xx) once, Inngest retries only `fetch-repo`; the job finishes `fetched` and the event is not re-sent. | each step durable, retried on its own |

---

## Evaluation & Acceptance (How we know the agent worked correctly)

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | URL table: 10 accepted forms, 8 rejected forms (incl. `javascript:alert(1)`, `https://gitlab.com/o/n`, `https://github.com/o`) | parsed / `UnsupportedUrlError` exactly as listed | vitest |
| 2 | Ladder row for `developit/mitt@6b41670516ed8e8b738612f60491995470aa63b3`, stub GitHub returns that SHA | `200 { ladderId }`, Inngest send spy called 0 times | vitest (integration, test DB) |
| 3 | Empty DB, same stub | `202 { jobId }`, one event with `{ repo, sha, jobId }` | vitest |
| 4 | 2 parallel calls, empty DB | 1 job row, same `jobId` in both responses | vitest |
| 5 | Inngest test run of the function with recorded fixture for `lukeed/dset` | snapshot row with 40-hex SHA; confidence row; status `fetched` | vitest + Inngest test helper |
| 6 | Stub returns 403 + `x-ratelimit-remaining: 0` in `fetch-repo` | status `failed`, reason `rate-limited`, 0 snapshot rows | vitest |
| 7 | Playwright: signed-in learner opens `/start?url=https://github.com/lukeed/dset` (stub GitHub, local Inngest dev server) | lands on `/jobs/:jobId`, sees `Reading the repo`, then `Done` | automated e2e |

### Verification Command (exact, runnable)

```bash
docker compose up -d db
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm typecheck && pnpm lint
pnpm test -- start-ladder repo-url fetch-repo jobs
pnpm test:e2e -- start-flow
```

### Evidence (filled by reviewer at Stage 4/5)

> **Moved.** Filled by the reviewer at Stage 4/5 in `tasks/TASK_REVIEW_T005.md`.

---

## Demonstration

> **Moved.** See `tasks/TASK_REVIEW_T005.md`.

---

## UI / Design Acceptance Criteria

> Screen: the job status page `/jobs/:jobId`. Check against the tokens file created in T003.

### 1. Visual Regression

| Screen / Component | Verification method | Expected result |
|-------------------|---------------------|-----------------|
| `/jobs/:jobId` in states `Queued`, `Reading the repo`, `Done`, `Failed: rate-limited` | Playwright screenshot per state + LLM-vision verdict against AC 7 | the status text is the main element; failed state shows the reason and the reset time in plain words; no stack trace or raw JSON |
| `/start?url=` with an unsupported URL | Playwright screenshot + LLM-vision verdict | page says only GitHub repo URLs work for now and shows the URL that was given (escaped) |

### 2. Design-System Compliance

| Criterion | Verification method | Expected result |
|-----------|---------------------|-----------------|
| Colors match design tokens | Playwright computed-style check of status text, error text, page background | values come from the T003 tokens file; grep finds no new hex literal in this task's components |
| Typography matches spec | computed `font-family`, `font-size`, `font-weight` of the status heading and body | T003 type scale |
| Spacing / layout matches spec | computed `padding` / `margin` of the page container | T003 spacing scale |

### 3. Layout / Responsiveness

| Viewport | Verification method | Expected result |
|----------|---------------------|-----------------|
| Mobile (360px) | Playwright screenshot at 360×740 + LLM-vision verdict; `scrollWidth <= 360` | long repo names wrap, no horizontal scroll |
| Tablet (768px) | Playwright screenshot at 768×1024 + LLM-vision verdict | status centered, no horizontal scroll |
| Desktop (1280px) | Playwright screenshot at 1280×800 + LLM-vision verdict | readable max-width column |

---

## Approach

**Pattern reference**: `experiments/core-spike/src/github.ts` — snapshot shape, `RateLimitError` / `RepoNotFoundError`, injectable `fetchImpl`, no partial snapshot on error; `experiments/core-spike/src/confidence.ts` — the confidence rule. Port both into the app (do not import from `experiments/`), adding the token header.

**Vital slice**: `POST /api/start` cache hit/miss on repo + SHA, and the `fetch-repo` Inngest step that writes the snapshot.
**Cut list**:
- non-GitHub URLs (clear "not supported yet" page only)
- push / websocket notification (status page polls every 2 s, stops on a final status)
- re-generation on a new SHA of an already-cached repo beyond what the cache key gives for free (a new SHA is simply a miss)
- private repos and per-learner GitHub tokens
- job cancellation

1. Migration (run `Skill({ skill: "migration-safety" })`; Common-Infrastructure applies it): `ladders` (`id`, `repo_full_name`, `commit_sha`, `status`, unique on `(repo_full_name, commit_sha)`), `generation_jobs` (`id`, `repo_full_name`, `commit_sha`, `status`, `reason`, `started_by`, timestamps, unique on `(repo_full_name, commit_sha)` for open jobs), `repo_snapshots` (keyed by repo + SHA, JSONB fields), `repo_confidence`. Store `repo_full_name` lower-cased.
2. Add Inngest (pinned exact version ≥ 2 weeks old) with its serve handler in the framework chosen by T003; local dev server pinned in a `pnpm inngest:dev` script.
3. App token: env `GITHUB_APP_TOKEN` (fine-grained, public read only); add the name to `.env.example`. Never log it. Every GitHub call checks `x-ratelimit-remaining`.
4. The request path does one GitHub call (resolve HEAD SHA) and one indexed DB lookup; everything else happens in the Inngest step. Later tasks append steps after `fetch-repo`.

---

## Edge Case Checklist

- [ ] Same repo with different letter case (`Developit/Mitt`) → same cache key
- [ ] Repo renamed or transferred: GitHub redirects (301) → follow once, cache under the canonical `full_name` from the API
- [ ] Empty repo (no commits) → `repo-empty` error, no job
- [ ] Archived repo → allowed; noted in the snapshot
- [ ] Open redirect: `/start` return target outside `/start?url=` on the same origin → ignored
- [ ] URL param missing or > 2,048 chars → 400 with a clear message
- [ ] A job is `failed`; a new `/start` for the same repo + SHA → a new job may start (failed jobs do not block the unique constraint)
- [ ] Rate limit hit in the request path (resolve SHA) → `503 { error: "rate-limited", resetAt }`, no job

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| app routes for `/start`, `/api/start`, `/api/jobs/:jobId`, `/jobs/:jobId` (layout set by T003) | entry points |
| app server modules: repo URL parser, GitHub client, confidence rule, start service, Inngest client + function `ladder-generate` with step `fetch-repo` | logic |
| new migration (T003's migration tool) | `ladders`, `generation_jobs`, `repo_snapshots`, `repo_confidence` |
| `package.json`, `pnpm-lock.yaml` | Inngest dependency; `inngest:dev` script |
| `.env.example` | `GITHUB_APP_TOKEN`, Inngest keys |
| tests (vitest + Playwright) and GitHub fixtures for the 3 v0 repos | AC 1–8 |
| `tasks/TASK_REVIEW_T005.md` | Evidence (reviewer) |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `.claude/**`, `agents/**`, `skills/**`, `templates/**`, `AGENTS.md`, `CLAUDE.md` | kit |
| `PRD.md`, `PROJECT_SPEC.md`, `PROJECT_KANBAN.md`, `BRAINSTORMING_LOG.md`, `memory/**` | Supervisor-owned |
| `experiments/**` | throwaway spikes; port code, do not import or edit |
| T003's OAuth/session modules and existing migrations | owned by T003; use them, do not change them |
| `eval/**` | T004 |

---

## Test Plan

vitest unit tests (URL parser, confidence port), integration tests on a test Postgres (start service hit/miss, concurrency, job API), Inngest function tests with the Inngest test helper and recorded GitHub fixtures (snapshot, rate limit, retry), Playwright e2e for the start flow and the UI section screenshots. Real run: local Inngest dev server + real `GITHUB_APP_TOKEN`, `/start?url=https://github.com/developit/mitt` twice — first a new job, second the same `jobId`; then insert a `ladders` row for that repo + SHA by hand in the dev DB and call it a third time → cache hit (no ladder row is written by this task; T008 writes them). Paste the output.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run
- [ ] Security review: `Skill({ skill: "security-review" })` run (Medium risk)
- [ ] Migration safety: `Skill({ skill: "migration-safety" })` run (new tables)
- [ ] Lint passes (`pnpm lint`, `pnpm typecheck`)
- [ ] Tests written AND pass — output pasted into `tasks/TASK_REVIEW_T005.md` Evidence (Hard-Stop Gate 5)
- [ ] `Skill({ skill: "verify" })` run — headless auto verify
- [ ] Supervisor notified: task ready for Stage 4 review
