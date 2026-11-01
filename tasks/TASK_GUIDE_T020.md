# TASK_GUIDE — T020: Public verify page: checks signature, re-checks GitHub evidence live
**Date**: 2026-11-01
**Complexity Level**: C2
**Risk Level**: High
**Priority**: P0
**Assigned agent**: frontend-developer
**Agent guide**: `agents/frontend.md`

---

## Mandatory Startup (Do Not Skip)

Before writing any code:
1. Read `PROJECT_SPEC.md`
2. Read the memory slice in your spawn prompt (`<!-- memory-slice -->`). Read `memory/MEMORY.md` in full only if your work reaches a file, hook, skill or decision the slice does not cover
3. Read this file completely
4. Read `agents/frontend.md`
5. Note the **Complexity Level** above and apply the matching process from the Complexity matrix in `agents/frontend.md`
6. C2: read `memory/codebase-map.md` (the app layout set by T003, once mapped). Read `tasks/TASK_GUIDE_T019.md` (credential and status list shapes, issuer JWKS), `tasks/TASK_GUIDE_T013.md` (what each artifact verifier checks), and `docs/REQUIREMENT_SOURCE.md` § Proof architecture.

---

## Requirement (Pillar 1 — Adapt the requirement)

Requirement § Proof architecture: "Public verify page — Checks the signature, then re-checks the GitHub evidence
live — Profile URL"; "The LLM is never in the trust path: every proof is deterministic evidence plus a signature.
Anyone can re-check a proof without trusting Idea Ladder's AI."; "Artifact: repo or branch exists, author matches,
commit SHA recorded, PR merged state". Sequence: pass test and proof: "15 Issuer→PWA signed badge + public verify
URL". PRD US-007: "As P2, I want a public verify page that checks the signature and re-checks GitHub evidence
live, so that I trust the proof without trusting the AI."

**Restated intent** (Supervisor's interpretation):
> A proof checker opens `/verify/<credentialId>` without signing in and sees, computed in their own browser,
> whether the signature is valid, whether the credential is revoked, and whether each GitHub artifact it lists
> still exists and matches the learner, read live from the GitHub API.

**Out of scope** (what this task explicitly does NOT do):
- Issuing or revoking credentials (T019); the learner's profile page (T021).
- Verifying Open Badges 3.0 credentials (T024 extends this page).
- Re-scoring MCQs or diff questions (their scores are inside signed evidence; the page shows them, it does not re-run them).
- Any LLM call.

**Requirement Refs**:
- FR-013: public verify page checks the signature and re-checks GitHub evidence live
- NFR-002: LLM never in the trust path; re-checkable by anyone
- NFR-003: artifacts belong to the GitHub account in the credential
- NFR-009: GitHub rate limits degrade to a clear message, not a false verdict
- US-007: the proof checker trusts the proof without trusting the AI

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [ ] Restated intent confirmed to match the user's request (by Supervisor / user — not the implementing agent)
- [ ] Domain terms align with `PROJECT_SPEC.md` glossary (`grill-with-docs` run if terminology was fuzzy)
- [ ] Every Acceptance Criterion below traces to a line in the Requirement
- [ ] All Requirement Refs exist in `PRD.md` and are fully covered by the Acceptance Criteria above

> An agent must NOT start implementing until this gate is checked. If anything here is unclear,
> STOP and ask the Supervisor (Karpathy: Think Before Coding).

---

## Dependencies & Reachability

**Depends on**: T019 — `GET /credentials/:id` (plus the evidence record URLs it lists), `GET /status/:listId` and `GET /.well-known/ladder-issuer.json` exist and are signed
**Entry point**: route `/verify/:credentialId` (page component `VerifyPage`)

> v2 task: planned only. Pickup waits for Gate 2 ("Others finish L1 without your help").

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | `/verify/:credentialId` renders without sign-in. It fetches the credential, the issuer JWKS and the status list, and verifies the Ed25519 signature in the browser with WebCrypto (`crypto.subtle.verify("Ed25519", ...)`) over the same canonical JSON hash as T019. The verdict line reads exactly one of `Signature valid`, `Signature invalid`. | "Checks the signature" |
| 2 | A credential whose index is in the signed status list shows `Revoked` (with the revocation date), even when the signature is valid. A status list whose own signature fails shows `Status unknown`, never `Not revoked`. | "Status list entry per credential" |
| 3 | After a valid signature, the page fetches each listed evidence record from its `evidenceUrl` and recomputes its hash; a mismatch with the signed `evidenceHash` marks that level `Evidence altered`. Then it re-checks each listed artifact live from the browser against `https://api.github.com`: L2 branch exists and the pinned commit exists with author = the credential's learner; L4 PR is merged (or repo exists) and author = learner. Each artifact row shows `Still matches`, `Changed` (with what changed) or `Could not check`. | "re-checks the GitHub evidence live"; "repo or branch exists, author matches, commit SHA recorded, PR merged state" |
| 4 | GitHub 403/429 with `x-ratelimit-remaining: 0`, a network error or a timeout (10 s) marks the row `Could not check` with the reset time when known. It never shows `Changed` or an overall failure because GitHub was unreachable. | NFR-009 |
| 5 | A tampered credential (any byte of the body changed in a test fixture) shows `Signature invalid` and the page does not run the GitHub re-check. An unknown `credentialId` shows a 404 page `Credential not found`. | "Anyone can re-check a proof" |
| 6 | The page shows the raw credential JSON, the issuer public key (JWK) and a "How to verify this yourself" block with the exact algorithm (canonical JSON → SHA-256 → Ed25519 over the hash string), so a checker can verify without this page. | "without trusting Idea Ladder's AI" |
| 7 | All credential fields are rendered as text (no HTML injection); outbound links are only `https://github.com/...` URLs taken from the credential, with `rel="noopener noreferrer"`. A field containing `<script>` renders literally. | security of a public page |

---

## Evaluation & Acceptance (How we know the agent worked correctly)

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | Fixture credential signed with a test key; GitHub mocked to match | `Signature valid`, every artifact row `Still matches` | Playwright (route mocks) |
| 2 | Same credential with `ladder` changed | `Signature invalid`; 0 requests to `api.github.com` | Playwright (request log) |
| 3 | Valid credential, index in status list | `Revoked` with date | Playwright |
| 4 | GitHub mock returns 403 + `x-ratelimit-remaining: 0` | rows `Could not check`, reset time shown; no `Changed` | Playwright |
| 5 | GitHub mock: L2 branch deleted | L2 row `Changed: branch not found` | Playwright |
| 6 | Credential field value `<script>alert(1)</script>` | text shown literally, no dialog fired | Playwright |
| 7 | Canonical JSON + hash in browser module vs T019 server module on 20 fixture credentials | identical hashes | vitest |

### Verification Command (exact, runnable)

```bash
pnpm install --frozen-lockfile && pnpm test -- verify && pnpm test:e2e -- verify-page && pnpm lint
```

### Evidence (filled by reviewer at Stage 4/5)

> **Moved.** Filled by the reviewer at Stage 4/5 in `tasks/TASK_REVIEW_T020.md`.

---

## Demonstration

> **Moved.** See `tasks/TASK_REVIEW_T020.md`.

---

## UI / Design Acceptance Criteria

### 1. Visual Regression

| Screen / Component | Verification method | Expected result |
|-------------------|---------------------|-----------------|
| `/verify/:credentialId` — valid, all artifacts match | Playwright screenshot at 1280 px + LLM-vision verdict against this guide's AC 1, 3, 6 | verdict line first, then per-level artifact rows, then raw JSON block; verdict "matches spec" |
| `/verify/:credentialId` — `Signature invalid` and `Revoked` states | Playwright screenshot + LLM-vision verdict | failure state is the first thing on the page, not below the fold; no green "valid" styling anywhere |
| `Could not check` row | Playwright screenshot + LLM-vision verdict | visibly neutral (not the failure colour), with reset time text |

### 2. Design-System Compliance

| Criterion | Verification method | Expected result |
|-----------|---------------------|-----------------|
| Colors match design tokens | computed-style check in Playwright on verdict and row status elements + token lint (no raw hex outside the token file set by T003/T010) | status colours come from the existing CSS custom properties; valid / invalid / neutral are three distinct tokens |
| Typography matches spec | computed-style check (`font-family`, `font-size`, `font-weight`) on the verdict line and the JSON block | verdict uses the heading token; JSON block uses the monospace token |
| Spacing / layout matches spec | computed-style check on row padding/gap | spacing values come from the existing spacing tokens |

### 3. Layout / Responsiveness

| Viewport | Verification method | Expected result |
|----------|---------------------|-----------------|
| Mobile (360px) | Playwright screenshot + LLM-vision verdict; assert `document.documentElement.scrollWidth <= 360` | single column; verdict line visible without scroll; JSON block scrolls inside itself, no page-level horizontal scroll |
| Tablet (768px) | Playwright screenshot + LLM-vision verdict | single column, wider rows |
| Desktop (1280px) | Playwright screenshot + LLM-vision verdict | artifact rows and the "How to verify" block readable at max content width |

---

## Approach

**Pattern reference**: T019's credential module (`verifyCredential`, canonical JSON) — the browser verifier must be the same algorithm; share the canonical JSON function as one isomorphic module rather than writing a second copy. For the GitHub checks imitate `experiments/core-spike/src/github.ts` error classes (`RateLimitError`, `RepoNotFoundError`).

**Vital slice**: signature verdict + revocation + live L2/L4 artifact rows for one credential.
**Cut list**:
- authenticated GitHub calls from the verify page (unauthenticated 60/h per viewer is enough for one page view)
- server-side "verified" cache or badge image (the verdict must be computed by the viewer's browser)
- OB 3.0 format (T024)
- printable / PDF view

Verification runs in the browser on purpose: the checker should not have to trust our server's verdict. The
server only serves the signed documents. Order: fetch three documents → verify credential signature → verify
status list signature → only if the credential is valid, run the GitHub checks in parallel with a 10 s timeout
each. WebCrypto Ed25519 needs a current browser; if `crypto.subtle` rejects the algorithm, show
`This browser cannot verify Ed25519 — use the steps below` plus AC 6's manual steps. Mock every GitHub call in
tests with Playwright `page.route`; tests never hit the network.

---

## Edge Case Checklist

- [ ] Browser without WebCrypto Ed25519 — explicit message, not `Signature invalid`
- [ ] Credential lists a commit SHA that was force-pushed away but still exists in the repo — `Still matches` only if the commit exists and author = learner; a missing branch alone is `Changed: branch not found`
- [ ] Learner renamed their GitHub account — compare the commit/PR author's GitHub user id with the credential's `learnerGithubId`, not only the login
- [ ] Repo made private or deleted since issue — `Changed: repository not found` (404), not `Could not check`
- [ ] Status list fetched but older than the credential — still check membership; show `updatedAt`
- [ ] Very long credential (many levels/evidence URLs) — rows render; JSON block scrolls
- [ ] `credentialId` path segment with odd characters — encoded, 404 for unknown

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| pages/routes folder in the app layout set by T003 (see `memory/codebase-map.md` once mapped) | `/verify/:credentialId` page (`VerifyPage`) and its 404 state |
| shared proof module from T019 | make canonical JSON + hash usable in the browser (no `node:crypto` import in the shared part) |
| new client module for GitHub live checks | branch / commit / PR checks with explicit error states |
| Playwright e2e test `verify-page` + fixtures | AC 1–7, screenshots |
| `tasks/TASK_REVIEW_T020.md` | Evidence (reviewer) |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `.claude/**`, `agents/**`, `skills/**`, `templates/**`, `AGENTS.md`, `CLAUDE.md` | kit |
| `PRD.md`, `PROJECT_SPEC.md`, `PROJECT_KANBAN.md` | Supervisor-owned |
| `experiments/**` | throwaway spikes |
| T019 issuance and signing code (`issueCredential`, status list writer) | backend-owned; consume the contract only |
| migrations | no schema change in this task |

---

## Test Plan

vitest: parity test of browser vs server canonical JSON/hash on fixtures (Success 7). Playwright e2e with mocked
API and GitHub routes for each state (Success 1–6), screenshots at 360/768/1280 px for the UI section, LLM-vision
verdict on each screenshot. Real run: `Skill({ skill: "run" })`, open a credential issued by T019 on the dev
DB, paste the screenshot and the browser console (no errors).

---

## Completion Checklist

- [ ] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run
- [ ] Security review: `Skill({ skill: "security-review" })` run (High risk)
- [ ] Lint passes (`pnpm lint`, `tsc --noEmit`)
- [ ] Tests written AND pass — output pasted into `tasks/TASK_REVIEW_T020.md` Evidence (Hard-Stop Gate 5)
- [ ] UI / Design Evidence rows filled with screenshots and verdicts (Hard-Stop Gate 6)
- [ ] `Skill({ skill: "verify" })` run — headless auto verify
- [ ] Supervisor notified: task ready for Stage 4 review
