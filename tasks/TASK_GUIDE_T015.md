# TASK_GUIDE — T015: Offline PWA (service worker cache), push reminders, export/import of progress
**Date**: 2026-11-01
**Complexity Level**: C2
**Risk Level**: Medium
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
6. C2: read `memory/codebase-map.md` (the app layout set by T003). Read `docs/REQUIREMENT_SOURCE.md` § Brainstorm: feature ideas (row "Offline PWA + push reminders"), § Grill #11, § Alternatives to investigate (row "Client"), § Diagram text "Architecture"; `docs/MAIN_FLOW.md` § 1; `tasks/TASK_GUIDE_T011.md` (review queue, `scheduleNext`, `submitReviewRating`).

---

## Requirement (Pillar 1 — Adapt the requirement)

Source (`docs/REQUIREMENT_SOURCE.md`):
- § Brainstorm: feature ideas: "Offline PWA + push reminders — Review anywhere; reminders drive return visits — MVP".
- § Grill #11: "iOS clears PWA storage? — Push install early; sync to backend; export/import — High".
- § Diagram text "Architecture": "PWA client (offline cache, push reminders, install prompt)".
- § Alternatives to investigate, row "Client": "PWA — Native app — Track iOS install rate, push opt-in, storage loss — iOS limits hurt review retention".
- § Diagram text "Roadmap": "v1 MVP PWA: ... pass tests, offline, push."

**Restated intent** (Supervisor's interpretation):
> The app installs as a PWA, and after one online visit the learner can do the daily review offline; ratings queue locally and sync to the server, which stays the source of truth. A daily push reminder fires only when cards are due. The learner can export progress to a file and import it back, but an import can never create proof or unlock a level.

**Out of scope** (what this task explicitly does NOT do):
- Offline pass tests (MCQ, diff questions, artifacts): they need the server and stay online-only.
- Offline ladder generation or ladder view of ladders never opened online.
- Native app; Anki deck export (§ Brainstorm "Maybe").
- Install-rate / push-opt-in analytics dashboard (the counters are stored; the dashboard is T018's Gate 2 metrics concern).

**Requirement Refs** (FR/NFR/US IDs from `PRD.md` this task satisfies):
- US-005: review offline and get push reminders
- FR-014: the PWA works offline and sends push reminders
- NFR-007: progress syncs to the backend and supports export/import

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [ ] Restated intent confirmed to match the user's request (by Supervisor / user — not the implementing agent)
- [ ] Domain terms align with `PROJECT_SPEC.md` glossary (`grill-with-docs` run if terminology was fuzzy)
- [ ] Every Acceptance Criterion below traces to a line in the Requirement
- [ ] All Requirement Refs exist in `PRD.md` and are fully covered by the Acceptance Criteria above

> An agent must NOT start implementing until this gate is checked. If anything here is unclear,
> STOP and ask the Supervisor (Karpathy: Think Before Coding).

---

## Dependencies & Reachability

**Depends on**: T011 — the review screen, `scheduleNext` (pure ts-fsrs wrapper), `submitReviewRating` with idempotency keys, and the review log the sync and export read.
**Entry point**: `Export progress` and `Import progress` (button labels on the settings screen), `Turn on reminders` (button label), service worker registered by `registerServiceWorker`

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | A web app manifest (name, icons 192 and 512 px, `display: standalone`, `start_url`) and a service worker are served; the browser reports the app installable. An install prompt appears after the learner's first completed review session, not on first load. | "install prompt"; "Push install early" |
| 2 | After one online visit, with the network off, the review screen loads and shows the due cards cached at the last sync. Each rating is applied locally with `scheduleNext` and queued in IndexedDB with its idempotency key and client `reviewedAt`. | "Review anywhere"; FR-014 offline |
| 3 | On reconnect, queued ratings are sent in order. The server recomputes each next state with `scheduleNext` from its stored state; it accepts the client `reviewedAt` only if it is after the card's last review and not later than server time + 5 min, else it uses server time. After sync, the local state equals the server state. A rating sent twice creates one log row. | "sync to backend"; NFR-007; FR-007 deterministic |
| 4 | `Turn on reminders` asks for notification permission and stores a Web Push subscription (VAPID). A daily scheduled job (Inngest cron, hourly tick) sends one push at the learner's chosen local hour only if ≥ 1 card is due; 0 due → no push. A subscription the push service answers with 404/410 is deleted. `Turn off reminders` deletes it. | "push reminders"; "reminders drive return visits" |
| 5 | `Export progress` downloads one JSON file `{ format: "idea-ladder-progress", version: 1, exportedAt, learner, cardStates, reviewLog, levelStatus, evidenceHashes }`. | "export/import"; NFR-007 |
| 6 | `Import progress` validates the file with a zod schema and merges only review data: a card state is replaced only if the imported last review is newer than the server's, and imported log rows are added by idempotency key. Import never writes evidence records, never changes level lock state, and rejects a file whose `learner` is not the signed-in account. A malformed or wrong-version file → clear error, nothing written. | Grill #11; proof stays server-side (NFR-002) |
| 7 | Pass tests and ladder generation show "You are offline — this needs a connection" when offline; no request is queued for them. | offline scope boundary |

---

## Evaluation & Acceptance (How we know the agent worked correctly)

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | Production build served locally | manifest valid; service worker active; `beforeinstallprompt` fires in Chromium | Playwright |
| 2 | Visit online, `context.setOffline(true)`, reload review screen, rate 3 cards | screen loads; 3 queued items in IndexedDB | Playwright |
| 3 | Go online | 3 log rows on the server; local and server card states deep-equal | Playwright + DB assert |
| 4 | Queued rating with `reviewedAt` = server time + 2 h | server uses server time; log row notes `clientTimeRejected` | integration test |
| 5 | Cron tick at the learner's hour with 2 due cards / with 0 due cards | 1 push sent to the mock push endpoint / 0 sent | integration test (Inngest test engine, mocked `web-push`) |
| 6 | Export, then import the same file | no change, no duplicate rows | integration test |
| 7 | Import file edited to add an evidence hash and unlock L3; file of another learner; `version: 2` | evidence and locks unchanged; rejected; rejected | integration test |

### Verification Command (exact, runnable)

```bash
# describe blocks of this task start with "T015"; Playwright runs against the production build
pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test -- -t "T015" && pnpm build && pnpm exec playwright test --grep T015
```

### Evidence (filled by reviewer at Stage 4/5)

> **Moved.** Filled by the reviewer at Stage 4/5 in `tasks/TASK_REVIEW_T015.md`.

---

## Demonstration

> **Moved.** See `tasks/TASK_REVIEW_T015.md`.

---

## UI / Design Acceptance Criteria

> Each row must name a verification method and produce pasted evidence before Done (Hard-Stop Gate 6).

### 1. Visual Regression

| Screen / Component | Verification method | Expected result |
|-------------------|---------------------|-----------------|
| Offline banner on the review screen | Playwright screenshot (offline context) at 360/768/1280 px + LLM-vision verdict with the rubric "banner says offline, review still usable, no error page" | "matches spec" on all 3 viewports |
| Settings screen: `Turn on reminders` / `Turn off reminders`, reminder hour picker, `Export progress`, `Import progress` | Playwright screenshot + LLM-vision verdict | all 4 controls visible and labelled; import error message visible for a bad file |
| Install prompt (in-app explainer shown before the browser prompt) | Playwright screenshot + LLM-vision verdict | one short message and two buttons (`Install`, `Not now`) |

### 2. Design-System Compliance

| Criterion | Verification method | Expected result |
|-----------|---------------------|-----------------|
| Colors match design tokens | Playwright computed-style check on banner, buttons | every color resolves to a CSS custom property of the theme used by T010/T011; no new hex literal in the diff (grep); manifest `theme_color` equals the theme's primary token value |
| Typography matches spec | computed style | body text ≥ 16 px; theme font stack |
| Spacing / layout matches spec | computed style | buttons have a tap target ≥ 44 × 44 px; the banner does not cover the rating buttons |

### 3. Layout / Responsiveness

| Viewport | Verification method | Expected result |
|----------|---------------------|-----------------|
| Mobile (360px) | Playwright screenshot + `scrollWidth <= 360` | banner one line or wraps without overflow; settings controls stacked |
| Tablet (768px) | Playwright screenshot | settings controls in one column, max width kept |
| Desktop (1280px) | Playwright screenshot | same layout as tablet, centred |

---

## Approach

**Pattern reference**: T011's review screen and `scheduleNext` — reuse the same pure function client-side and server-side so offline and online give the same state; T005's Inngest function setup for the cron job.

**Vital slice**: offline review with a local rating queue that syncs to the server without double-applying.
**Cut list**:
- background sync API (sync on `online` event and on app open instead; Safari lacks Background Sync)
- offline ladder view for ladders not opened online
- multiple reminders per day
- encrypted export file

Precache the app shell; cache the due-card payload (next 7 days of due cards) in IndexedDB at each online visit. Use a small IndexedDB wrapper already in the dependency tree if T003 added one; otherwise use `idb` pinned to an exact version published ≥ 2 weeks before 2026-11-01. Web Push: `web-push` pinned exactly; VAPID keys from server env, never in the client bundle except the public key. iOS: push works only after "Add to Home Screen" (iOS 16.4+); the reminder button explains that when `Notification` is missing. Store reminder hour + IANA timezone with the subscription. Write the migration (push subscription table); it must pass `Skill({ skill: "migration-safety" })` and Common-Infrastructure applies it.

---

## Edge Case Checklist

- [ ] New app version deployed while a learner is offline → old service worker keeps serving; new one activates on next online load; IndexedDB schema version upgrade keeps queued ratings
- [ ] iOS cleared storage → next online visit re-downloads due cards; queued ratings lost only if never synced (the export path is the backup)
- [ ] Same card rated offline on two devices → server applies both in `reviewedAt` order; second device's local state is replaced by the server state on sync
- [ ] Learner denies notification permission → button shows "Reminders blocked in browser settings"; no retry loop
- [ ] Learner changes timezone (travel) → reminder uses the stored timezone until they open settings
- [ ] Import file > 5 MB → rejected before parsing
- [ ] Signed-out user offline → no cached data of a previous user is shown (cache keyed by learner id; sign-out clears it)

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| web app manifest + icons (public assets folder set by T003) | new |
| service worker + `registerServiceWorker` | new |
| offline rating queue + sync module (client) | new |
| review screen (T011) | read from cache when offline; offline banner |
| `submitReviewRating` (T011) | accept validated client `reviewedAt` |
| settings screen: reminders, export, import | new |
| reminder cron Inngest function + push sender | new |
| export / import handlers | new |
| new migration (migrations folder set by T003) | push subscription table |
| `package.json`, lockfile | `web-push` (exact pin), IndexedDB wrapper if needed |
| tests (vitest, Playwright) | AC 1–7 |
| `tasks/TASK_REVIEW_T015.md` | Evidence (reviewer) |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `.claude/**`, `agents/**`, `skills/**`, `templates/**`, `AGENTS.md`, `CLAUDE.md` | kit |
| `PRD.md`, `PROJECT_SPEC.md`, `PROJECT_KANBAN.md` | Supervisor-owned |
| `experiments/**` | throwaway spikes; read only |
| `scheduleNext` internals (T011) | reuse unchanged; a change breaks determinism |
| evidence module, pass-test and verifier code (T012–T014) | proof stays server-side and online |
| applied migrations of earlier tasks | add a new migration instead |

---

## Test Plan

Unit (vitest): queue ordering, `reviewedAt` validation, import merge rules, export schema. Integration (vitest + test Postgres + Inngest test engine, mocked `web-push`): sync, reminders, import negatives. E2E (Playwright, production build, offline context): install, offline review, reconnect sync, UI rows above. Manual on one real iPhone (iOS ≥ 16.4) after install: one push received — recorded in the review with a screenshot. Paste `pnpm test` and Playwright output into the report.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run
- [ ] Security review: `Skill({ skill: "security-review" })` run (Medium risk)
- [ ] `Skill({ skill: "migration-safety" })` passed for the new migration
- [ ] Lint passes (`pnpm lint`, `pnpm typecheck`)
- [ ] Tests written AND pass — output pasted into `tasks/TASK_REVIEW_T015.md` Evidence (Hard-Stop Gate 5)
- [ ] UI Evidence rows (visual regression, design-system compliance, responsiveness) filled with pasted evidence (Hard-Stop Gate 6)
- [ ] `Skill({ skill: "verify" })` run — headless auto verify
- [ ] Supervisor notified: task ready for Stage 4 review
