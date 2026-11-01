# TASK_GUIDE — T031: Ladder from any URL (article or doc) as a concept-only ladder
**Date**: 2026-11-01
**Complexity Level**: C2
**Risk Level**: High
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
6. C2: read `memory/codebase-map.md` (if it is missing, ask the Supervisor to run `/map-codebase`) and `docs/claude-md/untrusted-content-boundary.md`

---

## Requirement (Pillar 1 — Adapt the requirement)

**Source**: `docs/REQUIREMENT_SOURCE.md` § Brainstorm: "Ladder from any URL (repo, doc, article) — Removes cold start; any source becomes a path — MVP". PRD FR-018. User choice 2026-11-01: v1 builds it ("as your recommend", memory/decisions.md).

### Restated intent

> A signed-in learner opens `/start?url=<article or doc URL>`. The app reads that one public page, pins its text by content hash, and builds a concept-only ladder through the existing T008 path: `fallbackToConcepts: true`, L0 generated, L1–L4 saved as `concept-only-skipped`.

### In scope

- `http`/`https` page fetch with SSRF protection; text extraction; a stored source snapshot.
- Ladder identity for a non-repo source (URL + content hash).
- Generation steps run on the page text in place of T006 and T007's repo inputs.
- `/start` and `/api/start` route non-GitHub URLs here. The T005 "not supported yet" page stays for URLs that are not `http`/`https`, and T023's pinned response follows this change.

### Out of scope (cut list)

- L1–L4 for articles: their pass tests need a repo (branch, PR). This is the assumption to confirm with the user, not a technical limit.
- Crawling several pages, PDFs, videos, pages behind sign-in, JavaScript-rendered pages.
- Non-GitHub repo hosts: a `gitlab.com` URL is treated as a plain page.

### Requirement refs

- FR-018, FR-015, NFR-004 (cache, here by URL + content hash), NFR-006 (original text, linked not copied), NFR-009 style degrade: clear error, no partial ladder.

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [ ] Restated intent confirmed to match the user's request (by Supervisor / user — not the implementing agent)
- [ ] Domain terms align with `PROJECT_SPEC.md` glossary
- [ ] All Requirement Refs exist in `PRD.md` and are fully covered by the Acceptance Criteria above

> An agent must NOT start implementing until this gate is checked. If anything here is unclear,
> STOP and ask the Supervisor (Karpathy: Think Before Coding).

---

## Dependencies & Reachability

**Depends on**: T008 — steps `chunk-and-embed`, generators, `save-ladder`, concept-only path; T010 — ladder view (link out to the source URL replaces README / DeepWiki for these ladders); T005 — `/start`, jobs, Inngest function
**Entry point**: `GET /start?url=` and `POST /api/start` with a non-GitHub URL

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | `/start?url=https://example.org/post` signed in → `202`/redirect to `/jobs/:jobId`; the job ends with a saved ladder: L0 generated, L1–L4 `concept-only-skipped`, status `unverified`. | FR-018 |
| 2 | SSRF: the fetcher refuses, before any connection and again at each redirect, hosts resolving to loopback, private, link-local, multicast or metadata addresses (IPv4 and IPv6, incl. mapped forms and DNS rebinding: connect to the checked address). Ports other than 80/443 and any scheme other than `http`/`https` are refused. At most 5 redirects. | Risk High |
| 3 | Limits: response body capped at 2 MB, 15 s total, only `text/html` and `text/plain`. Over a limit → job `failed` with a named reason, no partial ladder. | NFR-009 style |
| 4 | Cache: same normalised URL with the same content hash → no new generation, returns the ladder. Changed content → a new ladder. Tracking parameters (`utm_*`) and fragments do not change the key. | NFR-004 |
| 5 | A page with under 500 characters of extracted text → job `failed`, reason `not-enough-text`, with a plain page saying so. | no empty ladders |
| 6 | Untrusted content: page text saying "ignore previous instructions" does not add tools or change the output schema. Page text is rendered only as escaped text. | `docs/claude-md/untrusted-content-boundary.md` |
| 7 | NFR-006: no card or question shares ≥ 25 consecutive words with the page; the ladder links to the source URL, `rel="noopener noreferrer"`. | NFR-006 |
| 8 | Repo URLs behave exactly as before: T005 tests stay green unchanged, except the unsupported-URL cases this task replaces. | regression |
| 9 | Every model call goes through `logStepCost`. | cost per step |

---

## Evaluation & Acceptance (How we know the agent worked correctly)

### Success Criteria (observable, pass/fail)

| # | Scenario | Expected | How verified |
|---|----------|----------|--------------|
| 1 | Fixture article server, recorded model replies | ladder saved, L0 visible, L1–L4 skipped | vitest + e2e |
| 2 | `http://127.0.0.1/`, `http://169.254.169.254/`, `http://[::ffff:127.0.0.1]/`, a redirect to a private address, a name resolving to a private address | refused, no connection made | vitest with a local listener that records connections |
| 3 | 3 MB body, slow body, `application/pdf` | job `failed`, named reason | vitest |

### Verification Command (exact, runnable)

```bash
docker compose up -d db
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm typecheck && pnpm lint
pnpm test
pnpm test:e2e
```

### Evidence (filled by reviewer at Stage 4/5)

> **Moved.** Evidence lives in `tasks/TASK_REVIEW_T031.md`.

---

## Demonstration

> **Moved.** The Demonstration block lives in `tasks/TASK_REVIEW_T031.md`.

---

## Approach

1. Read T008's merged code first; the concept-only path is the integration point. If it does not fit, STOP and report.
2. Migration: add a source kind and URL to the ladder identity (`migration-safety` first). Prefer additive columns; the `repo_full_name` lower-case check must not be bent to hold URLs.
3. `src/start/page.ts`: fetch with address pinning, limits and redirect checks.
4. Route in `startLadder`: a GitHub repo URL goes the T005 way, any other `http(s)` URL goes here.

---

## Edge Case Checklist

- [ ] `github.com` URL that is not a repo (`/o/n/issues/1`): stays unsupported or is read as a page; pin the choice in a test
- [ ] Redirect from a public page to a GitHub repo
- [ ] Non-UTF-8 charset, NUL bytes (Postgres text refuses them)
- [ ] Page that changes on every fetch: each fetch is a new ladder; note the cost in the report

---

## Files to Change (Predicted)

| File | Change |
|---|---|
| `migrations/*` | ladder source identity |
| `src/start/page.ts`, `src/start/service.ts`, `src/start/repo-url.ts` | fetch and route |
| `src/workflow/ladder-generate.ts` | page branch |
| `src/app.tsx`, `src/views.tsx` | failure text, source link |
| `test/**`, `e2e/**` | tests above |

## Files Must NOT Touch

- `src/auth/**`
- Golden set under `eval/` (a repo set; page quality is reported separately)

---

## Test Plan

vitest with a local fixture server and recorded model replies; Playwright for the job and ladder pages. No live third-party sites in tests.

---

## Completion Checklist

- [ ] Acceptance Criteria covered by new tests
- [ ] `migration-safety` run
- [ ] Final report ends with `Startup reads:`
