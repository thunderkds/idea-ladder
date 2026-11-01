# TASK_GUIDE — T021: Shareable proof profile page
**Date**: 2026-11-01
**Complexity Level**: C1
**Risk Level**: Low
**Priority**: P1
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
6. C1: skip `memory/codebase-map.md` unless you cannot find the route and page folders from T020's page. Read `tasks/TASK_GUIDE_T020.md` (the verify page this profile links to) and `tasks/TASK_GUIDE_T019.md` (credential shape).

---

## Requirement (Pillar 1 — Adapt the requirement)

Requirement § Brainstorm: feature ideas: "Proof-of-skill profile page — Shareable output; gives a reason to
finish". § Problem and first user: "No way to show what you actually learned — Each level passed leaves a proof
(repo, PR, explanation)". Vision flow: "passed → Proof profile (repo, PR, explanation)". Roadmap v2: "Public
proof profile". Gate 3: "Proof links get shared".

**Restated intent** (Supervisor's interpretation):
> A learner can turn on a public profile at `/u/<githubLogin>` that lists their issued credentials and passed
> levels (repo, PR, explanation), each linking to its verify page, and copy that link to share it.

**Out of scope** (what this task explicitly does NOT do):
- Verifying signatures or GitHub evidence on the profile (the verify page, T020, does that; the profile only links).
- Editing explanations or any level data; author credit counts (T027).
- Custom profile themes, avatars beyond the GitHub avatar URL, follower features.

**Requirement Refs**:
- US-006: show what I learned (proof per passed level and credential)
- FR-013: each listed credential links to the public verify page
- NFR-006: repo code and docs are linked, not copied (the profile shows links, not repo content)

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [ ] Restated intent confirmed to match the user's request (by Supervisor / user — not the implementing agent)
- [ ] Domain terms align with `PROJECT_SPEC.md` glossary (`grill-with-docs` run if terminology was fuzzy)
- [ ] Every Acceptance Criterion below traces to a line in the Requirement
- [ ] All Requirement Refs exist in `PRD.md` and are fully covered by the Acceptance Criteria above

> An agent must NOT start implementing until this gate is checked. If anything here is unclear,
> STOP and ask the Supervisor (Karpathy: Think Before Coding).

---

## Dependencies & Reachability

**Depends on**: T020 — `/verify/:credentialId` exists; every profile entry links to it
**Entry point**: route `/u/:githubLogin` (page component `ProofProfilePage`); toggle label `Make my proof profile public`

> v2 task: planned only. Pickup waits for Gate 2 ("Others finish L1 without your help").

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | A signed-in learner sees a toggle `Make my proof profile public` (default off). While off, `/u/<login>` returns a 404 page for everyone except the owner, who sees a preview banner `Only you can see this`. | "Shareable output" (sharing is the learner's choice) |
| 2 | While on, `/u/<login>` renders without sign-in and lists each issued, non-revoked credential: repo `owner/name`, pinned SHA (7 chars), issue date and a `Verify` link to `/verify/<credentialId>`. | "Public proof profile"; links to verify page |
| 3 | Each credential expands to its passed levels L0–L4 with the evidence kind per level: L1 explanation text, L2 branch link, L4 repo or PR link (all from the evidence records). | "Proof profile (repo, PR, explanation)" |
| 4 | A `Copy profile link` button copies the absolute profile URL; the page has `<title>` and Open Graph tags (`og:title`, `og:description`, `og:url`) naming the learner and credential count. | "Shareable" |
| 5 | A revoked credential is not listed; a learner with the profile on and 0 credentials sees `No ladders completed yet` (the public view shows the same text). | boundary; revocation (T019) |
| 6 | All learner-supplied text (explanations) renders as text, never HTML; links are only `https://github.com/...` URLs from evidence records. | NFR-006; safe public page |

---

## Evaluation & Acceptance (How we know the agent worked correctly)

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | Profile off, anonymous visitor | 404 page | Playwright |
| 2 | Profile off, owner signed in | preview banner `Only you can see this` | Playwright |
| 3 | Profile on, 2 credentials, 1 revoked | 1 entry with `Verify` link to the right `/verify/<id>` | Playwright |
| 4 | Click `Copy profile link` | clipboard holds `https://<host>/u/<login>` | Playwright (clipboard permission) |
| 5 | Explanation text `<img src=x onerror=alert(1)>` | rendered literally, no dialog | Playwright |

### Verification Command (exact, runnable)

```bash
pnpm install --frozen-lockfile && pnpm db:migrate && pnpm test:e2e -- proof-profile && pnpm lint
```

### Evidence (filled by reviewer at Stage 4/5)

> **Moved.** Filled by the reviewer at Stage 4/5 in `tasks/TASK_REVIEW_T021.md`.

---

## Demonstration

> **Moved.** See `tasks/TASK_REVIEW_T021.md`.

---

## UI / Design Acceptance Criteria

### 1. Visual Regression

| Screen / Component | Verification method | Expected result |
|-------------------|---------------------|-----------------|
| `/u/:githubLogin` public, 2 credentials, one expanded | Playwright screenshot at 1280 px + LLM-vision verdict against AC 2–4 | header (login, avatar, credential count, `Copy profile link`), then credential cards; verdict "matches spec" |
| empty state `No ladders completed yet` | Playwright screenshot + LLM-vision verdict | centred empty-state text, no broken cards |
| owner preview banner | Playwright screenshot + LLM-vision verdict | banner above content, clearly not part of the public page |

### 2. Design-System Compliance

| Criterion | Verification method | Expected result |
|-----------|---------------------|-----------------|
| Colors match design tokens | computed-style check in Playwright on card, banner and links + token lint (no raw hex outside the token file set by T003/T010) | values equal the existing CSS custom properties |
| Typography matches spec | computed-style check on page heading, card title, explanation text | heading / body tokens from T010's ladder view |
| Spacing / layout matches spec | computed-style check on card padding and list gap | existing spacing tokens |

### 3. Layout / Responsiveness

| Viewport | Verification method | Expected result |
|----------|---------------------|-----------------|
| Mobile (360px) | Playwright screenshot + LLM-vision verdict; assert `document.documentElement.scrollWidth <= 360` | one card per row; long repo names wrap; no horizontal page scroll |
| Tablet (768px) | Playwright screenshot + LLM-vision verdict | one column, wider cards |
| Desktop (1280px) | Playwright screenshot + LLM-vision verdict | content at max content width, cards readable |

---

## Approach

**Pattern reference**: T020's `VerifyPage` — data fetching, safe text rendering of credential fields, link rules; reuse its components for credential and level rows.

**Vital slice**: public list of credentials with `Verify` links, plus the opt-in toggle.
**Cut list**:
- per-credential hide/show (all-or-nothing toggle)
- profile analytics (view counts)
- custom slug other than the GitHub login
- in-progress ladders on the public profile (only issued credentials)

Add one boolean `proof_profile_public` (default false) on the learner row through a migration; run
`Skill({ skill: "migration-safety" })` (additive column, default value, no backfill risk). The page reads only
data that T019 already exposes publicly per credential, so the toggle controls listing, not secrecy of a
credential already shared by URL. Look up by GitHub login, case-insensitive.

---

## Edge Case Checklist

- [ ] Login case differs (`/u/ThunderKDS` vs `thunderkds`) — same profile
- [ ] Learner renamed on GitHub — profile follows the current login stored at sign-in; old login → 404
- [ ] Credential revoked after the page was cached by a browser — the server response excludes it (no long cache headers on this page)
- [ ] Explanation text very long — clamp to 3 lines with `Show more`
- [ ] Toggle switched off while another person has the page open — next load returns 404
- [ ] Clipboard API unavailable — show the URL in a selectable text field instead

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| pages/routes folder in the app layout set by T003 (see `memory/codebase-map.md` once mapped) | `/u/:githubLogin` page (`ProofProfilePage`), settings toggle |
| new migration in T003's migrations folder | `proof_profile_public boolean not null default false` on the learner table |
| API route for the profile data (T003 layout) | read-only list of issued, non-revoked credentials for a public profile |
| Playwright e2e test `proof-profile` | AC 1–6, screenshots |
| `tasks/TASK_REVIEW_T021.md` | Evidence (reviewer) |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `.claude/**`, `agents/**`, `skills/**`, `templates/**`, `AGENTS.md`, `CLAUDE.md` | kit |
| `PRD.md`, `PROJECT_SPEC.md`, `PROJECT_KANBAN.md` | Supervisor-owned |
| `experiments/**` | throwaway spikes |
| T019 credential issuance and signing code; T020 verify logic | owned by those tasks; reuse components only |

---

## Test Plan

Playwright e2e on a seeded test DB for each AC (Success 1–5) with screenshots at 360/768/1280 px and an
LLM-vision verdict per screenshot. Real run: `Skill({ skill: "run" })`, turn the toggle on, open the profile in
a private window, paste the screenshot.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run
- [ ] `Skill({ skill: "migration-safety" })` run (new column)
- [ ] Lint passes (`pnpm lint`, `tsc --noEmit`)
- [ ] Tests written AND pass — output pasted into `tasks/TASK_REVIEW_T021.md` Evidence (Hard-Stop Gate 5)
- [ ] UI / Design Evidence rows filled with screenshots and verdicts (Hard-Stop Gate 6)
- [ ] `Skill({ skill: "verify" })` run — headless auto verify
- [ ] Supervisor notified: task ready for Stage 4 review
