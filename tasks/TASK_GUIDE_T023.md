# TASK_GUIDE — T023: "Learn this" contract with Idea Radar (document + contract test of /start?url=)
**Date**: 2026-11-01
**Complexity Level**: C1
**Risk Level**: Low
**Priority**: P2
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
6. C1: skip `memory/codebase-map.md` unless you cannot find T005's `/start` handler. Read `tasks/TASK_GUIDE_T005.md` (what `/start?url=` does today) and `docs/REQUIREMENT_SOURCE.md` § Architecture.

---

## Requirement (Pillar 1 — Adapt the requirement)

Requirement § Architecture: "Independence test: delete either app and the other still works. No shared database,
login or API between them. The only contract is `https://<ladder-app>/start?url=<repo or any URL>`, the same
pattern as "Open in Gitpod" or "Deploy to Vercel" buttons. Idea Ladder accepts URLs pasted by hand too."
§ Vision: "Relationship to Idea Radar: fully independent ... They connect only by a URL". Roadmap v2: ""Learn
this" in Radar". v0 kill criteria: "Pull — You want a "Learn this" button in Idea Radar". Brief: "the button
lives in the Radar repo".

**Restated intent** (Supervisor's interpretation):
> Write down the one URL contract Idea Radar may rely on and pin it with a contract test in this repo, so any
> change to `/start?url=` that would break a "Learn this" link fails CI. The button itself is built in the Radar
> repo, by whoever the user names.

**Out of scope** (what this task explicitly does NOT do):
- Any code, PR or file in the Idea Radar repo, unless the user picks option B below.
- Any shared DB, login, API key or callback between the two apps.
- New behaviour of `/start` (T005 owns it); this task only documents and pins it.
- The weekly trending pick (T029).

**Requirement Refs**:
- FR-015: the only contract with Idea Radar is `/start?url=`; hand-pasted URLs also work
- US-001: open `/start?url=` and get a ladder

### Decision needed from the user

Question: Who adds the "Learn this" button to the Idea Radar repo, and where is that repo?

| Option | What happens | Trade-off |
|---|---|---|
| A. The user adds it (recommended) | This task ships `docs/contracts/start-url.md` with a copy-paste button snippet; the user adds it in Radar | No cross-repo access needed; the button waits on the user |
| B. The agent opens a PR in the Radar repo | User gives the local path or GitHub name of the Radar repo; the agent adds the link there in a separate branch | Button lands in one pass; the agent then touches a second repo (needs its own guide/board per Hard-Stop Gate 4) |
| C. Contract only, no button yet | Document + contract test only; the button is a later Radar task | Smallest; Roadmap v2 item ""Learn this" in Radar" stays open |

The agent stops with `Status: blocked` + `Question:` until answered.

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [ ] Restated intent confirmed to match the user's request (by Supervisor / user — not the implementing agent)
- [ ] Domain terms align with `PROJECT_SPEC.md` glossary (`grill-with-docs` run if terminology was fuzzy)
- [ ] Every Acceptance Criterion below traces to a line in the Requirement
- [ ] All Requirement Refs exist in `PRD.md` and are fully covered by the Acceptance Criteria above

> An agent must NOT start implementing until this gate is checked. If anything here is unclear,
> STOP and ask the Supervisor (Karpathy: Think Before Coding).

---

## Dependencies & Reachability

**Depends on**: T005 — `GET /start?url=` exists (reads the repo, pins the SHA, starts the background job, shows the status page)
**Entry point**: `/start?url=` (contract test file `start-url.contract.test.ts`; document `docs/contracts/start-url.md`)

> v2 task: planned only. Pickup waits for Gate 2 ("Others finish L1 without your help").

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | `docs/contracts/start-url.md` states: the URL form `https://<ladder-app>/start?url=<percent-encoded URL>`; accepted GitHub URL forms; the response for each case below; the guarantee "no auth, no shared data, no callback"; a versioning rule (the contract changes only additively); and a copy-paste link snippet for Radar. | "The only contract is ..." |
| 2 | Contract test: `/start?url=` with each of `https://github.com/o/r`, `https://github.com/o/r/`, `https://github.com/o/r.git`, `https://github.com/o/r/tree/main`, `http://github.com/o/r`, and the same URL percent-encoded once, resolves to the same repo `o/r` and the same response kind as T005 defines for a GitHub repo. | "<repo or any URL>" |
| 3 | Contract test: `/start` with no `url`, an empty `url`, a non-URL string, or a `javascript:` / `data:` URL returns the T005 error response (a 400-class status and a readable message), never a 5xx and never a redirect to the given value. | boundary; safe public entry |
| 4 | Contract test: `/start?url=` for a non-GitHub URL returns whatever T005 defines for "any URL" today; the test pins that response so a change is a visible contract change. | "or any URL" |
| 5 | The contract test runs without any Idea Radar code, data or credentials (GitHub mocked with recorded responses), proving the independence test from this side. | "delete either app and the other still works" |
| 6 | A link with extra query parameters (`/start?url=...&utm_source=radar`) behaves like the same link without them. | Radar adds a link only |

---

## Evaluation & Acceptance (How we know the agent worked correctly)

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | 6 GitHub URL forms of `o/r` | same repo, same response kind | vitest contract test |
| 2 | `/start?url=javascript:alert(1)` | 400-class, no `Location` header with that value | vitest contract test |
| 3 | `/start` with no `url` | 400-class with message | vitest contract test |
| 4 | `/start?url=https://example.com/post` | the pinned T005 response for a non-GitHub URL | vitest contract test |
| 5 | `docs/contracts/start-url.md` | contains the URL form, each case of AC 2–4, the versioning rule and the snippet | vitest doc check (greps the headings) |

### Verification Command (exact, runnable)

```bash
pnpm install --frozen-lockfile && pnpm test -- start-url.contract && pnpm lint
```

### Evidence (filled by reviewer at Stage 4/5)

> **Moved.** Filled by the reviewer at Stage 4/5 in `tasks/TASK_REVIEW_T023.md`.

---

## Demonstration

> **Moved.** See `tasks/TASK_REVIEW_T023.md`.

---

## Approach

**Pattern reference**: T005's `/start` handler tests (request in, response kind out); `experiments/core-spike/src/fixture-fetch.ts` `replayFetch` for offline GitHub responses.

**Vital slice**: the contract test over the GitHub URL forms and the bad-input cases.
**Cut list**:
- button styling or a badge image for Radar (a plain link is the contract)
- analytics on `utm_source` (ignored, not stored)
- a versioned path such as `/v1/start` (additive changes only, so not needed)

Write the doc from what T005 actually does, not from what it should do; if T005's behaviour contradicts
§ Architecture (for example, it requires sign-in before it accepts the URL), stop and report it as a `fact`
question instead of changing T005. Tests call the handler in-process with a mocked GitHub fetch.

---

## Edge Case Checklist

- [ ] URL double-encoded by a careless caller — document as unsupported; test that it fails cleanly (400-class), not silently resolves a wrong repo
- [ ] GitHub URL with a deep path (`/blob/main/src/x.ts`) — resolves to the repo (or T005's documented behaviour), pinned in the test
- [ ] Mixed-case owner/repo (`O/R`) — same repo as `o/r`
- [ ] Learner not signed in when they click the link — documented T005 behaviour (sign-in then continue with the same `url`), pinned
- [ ] Very long `url` (> 2,048 chars) — 400-class
- [ ] `https://github.com/o` (owner only) — 400-class with message

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| `docs/contracts/start-url.md` | new contract document with Radar snippet |
| `start-url.contract.test.ts` in the test folder of the app layout set by T003 (see `memory/codebase-map.md` once mapped) | contract tests AC 2–6 |
| GitHub response fixtures for the contract test | recorded once, offline in tests |
| `tasks/TASK_REVIEW_T023.md` | Evidence (reviewer) |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `.claude/**`, `agents/**`, `skills/**`, `templates/**`, `AGENTS.md`, `CLAUDE.md` | kit |
| `PRD.md`, `PROJECT_SPEC.md`, `PROJECT_KANBAN.md` | Supervisor-owned |
| `experiments/**` | throwaway spikes |
| T005's `/start` handler | owned by T005; this task pins it, does not change it |
| the Idea Radar repo | another repo; only under option B, with its own guide |

---

## Test Plan

vitest contract tests in-process with mocked GitHub (Success 1–4) and a doc check (Success 5). Real run: start
the app, open each URL form in a browser and paste the resulting page or status for 3 of them.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run
- [ ] Lint passes (`pnpm lint`, `tsc --noEmit`)
- [ ] Tests written AND pass — output pasted into `tasks/TASK_REVIEW_T023.md` Evidence (Hard-Stop Gate 5)
- [ ] `Skill({ skill: "verify" })` run — headless auto verify
- [ ] Supervisor notified: task ready for Stage 4 review
