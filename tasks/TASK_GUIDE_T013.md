# TASK_GUIDE — T013: GitHub artifact verifiers — L2 branch, L4 repo or merged PR, L1 verifier design
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
6. C2: read `memory/codebase-map.md` (the app layout set by T003). Read `docs/REQUIREMENT_SOURCE.md` § Repo to ladder engine (level table), § Proof architecture, § Diagram text "Sequence: pass test and proof" and "Evidence record example"; `docs/MAIN_FLOW.md` § 4 and § 6; `PRD.md` FR-004 FLAGGED note; `experiments/core-spike/RESULTS.md` § 3.

---

## Requirement (Pillar 1 — Adapt the requirement)

Source (`docs/REQUIREMENT_SOURCE.md`):
- § Repo to ladder engine, level table: "L1 Run it — Clone, run, explain what it does — Screenshot or log + 3-sentence explanation"; "L2 Modify — Change or add one small feature — Branch or diff link + questions generated from your diff"; "L4 Rebuild or contribute — Minimal version from scratch, or a merged PR — Repo link or PR link".
- § Proof architecture: "Identity binding — Learner signs in with GitHub OAuth; every artifact must belong to that GitHub account." "Verifiers (code only) — ... Artifact: repo or branch exists, author matches, commit SHA recorded, PR merged state."
- § Sequence: pass test and proof: "submit L2 branch" → "branch exists? author = learner?" → "diff + commit SHA".
- `PRD.md` FR-004 note: "FLAGGED (v1 only): L1 proof (screenshot/log + explanation) has no code verifier in § Proof architecture — define how L1 passes before v1 planning."
- `docs/MAIN_FLOW.md` § 6: "Each app calls the GitHub API with its own token".

**Restated intent** (Supervisor's interpretation):
> Code-only verifiers check that a learner's L2 branch and L4 repo or merged PR exist on GitHub, belong to the signed-in GitHub account, and are pinned to a recorded commit SHA. The L1 pass rule is set by the user's answer below and is built to the same rule: no LLM decides it.

**Out of scope** (what this task explicitly does NOT do):
- Diff questions and the L2 pass itself (T014): T013 only marks the L2 artifact verified and hands the diff + SHA on.
- Signed credential on ladder completion (T019); live re-check on the public verify page (T020).
- Any AI judgment of the L1 explanation as a gate (feedback only, FR-008).
- Submission screen UI (server handlers only).

**Requirement Refs** (FR/NFR/US IDs from `PRD.md` this task satisfies):
- FR-004: L1 / L2 / L4 pass tests (artifact parts)
- FR-010: artifact exists, author matches the signed-in account, commit SHA recorded, PR merged state
- FR-011: evidence record per passed level (L1, L4)
- NFR-002: the LLM is never in the trust path
- NFR-003: every artifact belongs to the GitHub account signed in by OAuth
- NFR-009: GitHub rate limits → clear error, no partial result
- US-003, US-006

### Decision needed from the user

**Question**: How does L1 ("Run it — Screenshot or log + 3-sentence explanation") pass, given that no code can verify a screenshot?

| Option | How L1 passes | Trade-off |
|---|---|---|
| A — Signed run log on GitHub | The app shows a one-time nonce. The learner runs the repo, saves the run output with the nonce in it as a file in a public gist (or a commit on a branch of their fork), and pastes the link. Code checks: gist/commit exists, owner = learner's GitHub id, created after the nonce was issued, contains the nonce. The 3-sentence explanation is stored and gets AI feedback only. | Code-verifiable and re-checkable by anyone; the learner can still fake the log text. One more step for the learner. |
| B — MCQ on running it | L1 passes through the T012 MCQ pass test on the README/setup chunks ("which command starts it"). Screenshot or log and explanation are optional, stored, feedback only. | No new verifier; reuses T012. Proves reading the setup docs, not running the repo. |
| C — Self-attested | Learner uploads a screenshot or log and the explanation; code checks only presence and the 3-sentence shape. The evidence record says `test: "self-attested"`. | Fastest; honest label. Weakest proof; a proof checker sees it is not verified. |

Supervisor recommendation: A (the only option that keeps L1 inside "GitHub-checked artifacts"). **The agent stops with `Status: blocked` + `Question:` until the user answers.** AC 6 below is written for option A; if the user picks B or C, the Supervisor rewrites AC 6 before spawn.

**Answered 2026-11-19 (auto, [admin]) by Debate: option B** — see `## Questions Log`. The agent does not stop for this question; AC 6 is written for option B.

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [x] Restated intent confirmed to match the user's request (by Supervisor / user — not the implementing agent) — auto (Supervisor) 2026-11-19: L1 rule settled by Debate (option B); matches FR-007/010/011, NFR-002/003/009 and the user's "complete all task [admin]"
- [x] Domain terms align with `PROJECT_SPEC.md` glossary (`grill-with-docs` run if terminology was fuzzy)
- [x] Every Acceptance Criterion below traces to a line in the Requirement
- [x] All Requirement Refs exist in `PRD.md` and are fully covered by the Acceptance Criteria above

> An agent must NOT start implementing until this gate is checked. If anything here is unclear,
> STOP and ask the Supervisor (Karpathy: Think Before Coding).

---

## Dependencies & Reachability

**Depends on**: T012 — `writeEvidenceRecord` (canonical JSON + SHA-256, append-only table), the pass-test rate limit and the level unlock transaction.
**Entry point**: `verifyL2Branch`, `verifyL4Artifact` (server handlers; L1 uses T012's MCQ routes; route paths follow the app layout set by T003)

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | `verifyL2Branch(learner, ladder, branchUrl)` accepts only `https://github.com/<owner>/<repo>/tree/<branch>`. It passes iff: the branch exists; the repo is the ladder's repo or a fork of it (`parent.full_name` = ladder repo); the compare range `ladder pinned SHA ... branch head` has ≥ 1 commit and a non-empty diff; every commit in that range has `author.id` = the signed-in learner's GitHub numeric id. It records the head commit 40-hex SHA. | "branch exists? author = learner?"; "commit SHA recorded" |
| 2 | A passed L2 check stores an artifact row `{ learner, ladder, level: "L2", url, headSha, verifiedAt }` and emits the event that T014 consumes. It does **not** unlock L3 and writes no evidence record (L2 passes only with diff questions, T014). | L2 = "Branch or diff link + questions generated from your diff" |
| 3 | `verifyL4Artifact(learner, ladder, url)` accepts a repo link or a PR link. Repo: exists, public, `owner.id` = learner id, ≥ 1 commit authored by the learner; records the default-branch head SHA. PR: in the ladder's repo (upstream), `merged = true`, `user.id` = learner id; records `merge_commit_sha`. A pass writes an evidence record (`test: "artifact"`) through `writeEvidenceRecord` and completes the ladder. | "Repo link or PR link"; "PR merged state" |
| 4 | Negative: a branch or PR authored by another account, an open (unmerged) PR, a closed-unmerged PR, a private or missing repo, or a branch with only commits already in the pinned SHA → rejected with a reason code (`author-mismatch`, `pr-not-merged`, `not-found`, `no-new-commits`); nothing stored. Identity uses numeric ids, never commit email or display name. | NFR-003 "every artifact must belong to that GitHub account" |
| 5 | GitHub 403/429 with `x-ratelimit-remaining: 0` → `RateLimitError` surfaced as HTTP 503 with `retryAt`; 404 → `not-found`; no partial artifact row, no evidence record. Calls use the app's own GitHub token (server env), never a token sent by the client. | NFR-009; MAIN_FLOW § 6 "own token" |
| 6 | (Option B, Debate 2026-11-19) L1 passes through the T012 MCQ pass test: add `L1` to `MCQ_LEVELS` (src/server/level-generator.ts) and `POOL_LEVELS` (src/server/save-ladder.ts) so the L1 generator writes an MCQ pool from the README + docs chunks it already gets, with questions on installing, starting and configuring the repo and on what running it shows (port, first output, required env var). L1 `passTest.kind` becomes `run-mcq` in both src/shared/levels.ts and src/server/level-generator.ts (one name), description "MCQs on setting up and running it; a run log and a 3-sentence explanation are optional feedback". A pasted run log and the explanation (exactly 3 sentences, ≤ 600 chars) may be stored as feedback only; they are never scored and never in the evidence record. No new verifier for L1; the evidence record is T012's `test: "mcq"`. | L1 "Run it"; FR-007, FR-010 (verified MCQs only), NFR-002 |
| 7 | No LLM call is reachable from any verifier (AI SDK client and `generate` mocked to throw; all tests pass). All tests run offline from recorded GitHub fixtures. | NFR-002 |

---

## Evaluation & Acceptance (How we know the agent worked correctly)

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | Fixture: fork of the ladder repo, branch with 2 commits by the learner's id | L2 artifact row with 40-hex `headSha`; event emitted; no evidence record; L3 still locked | integration test |
| 2 | Same branch, one commit `author.id` of another account (same email as learner) | `author-mismatch`; no row | integration test |
| 3 | Fixture: PR in the upstream repo, `merged: true`, `user.id` = learner | evidence record `test: "artifact"`, `merge_commit_sha` stored, hash recomputes | integration test |
| 4 | PR with `merged: false` | `pr-not-merged`; no record | integration test |
| 5 | Mocked 403 + `x-ratelimit-remaining: 0` mid-verification | 503 with `retryAt`; no rows | integration test |
| 6 | (Option B) ladder generated with a README that yields ≥ 8 L1 MCQs; an L1 MCQ attempt with 8 of 10 correct | L1 pool saved (`POOL_LEVELS` has L1), the attempt passes through T012, evidence `test: "mcq"`, L2 opens; a thin README → L1 flagged `insufficient-pool`, attempt `pool-too-small` | integration test |
| 7 | Branch URL `https://github.com.evil.io/...` or `http://` scheme | rejected as invalid input before any fetch | bun test |

### Verification Command (exact, runnable)

```bash
# describe blocks of this task start with "T013"; GitHub calls replay recorded fixtures (no network)
bun install --frozen-lockfile && bun run typecheck && bun run lint && bun test -t "T013"
```

### Evidence (filled by reviewer at Stage 4/5)

> **Moved.** Filled by the reviewer at Stage 4/5 in `tasks/TASK_REVIEW_T013.md`.

---

## Demonstration

> **Moved.** See `tasks/TASK_REVIEW_T013.md`.

---

## Approach

**Pattern reference**: `experiments/core-spike/src/github.ts` — injected `fetchImpl`, `RateLimitError` / `RepoNotFoundError`, no partial snapshot on error; `experiments/core-spike/src/fixture-fetch.ts` — recorded fixtures replayed offline. Port the patterns; do not import from `experiments/`. The GitHub client of T005 is the app's own version of these — extend it, do not write a second client.

**Vital slice**: `verifyL2Branch` (author id + pinned-SHA compare + head SHA) — it feeds T014 and is the core anti-cheat check.
**Cut list**:
- GitLab or other hosts (GitHub only)
- re-verification on a schedule (T020 re-checks live on the verify page)
- webhook-driven PR-merge detection (the learner re-submits after the merge)
- L1 options B and C (built only if the user picks them)

Parse URLs with `new URL()` and an exact host check `github.com`; reject anything else before a fetch. Use GitHub REST: repo, branch, compare `base...head`, pulls. Paginate compare commits (> 250 commits → reject as `range-too-large`; an L2 change is "one small feature"). Compare identity on numeric `id` from the OAuth account stored by T003. (Option A nonce: not built — option B chosen.) Write the migration `0014_artifacts` (artifact table); it must pass `Skill({ skill: "migration-safety" })` and Common-Infrastructure applies it.

---

## Edge Case Checklist

- [ ] Learner renamed their GitHub login since sign-in → ids still match; `learner` field in records uses the current login from the OAuth account
- [ ] Commit with `author: null` (email not linked to any account) → `author-mismatch`
- [ ] Branch name with `/` (`feature/retry`) → parsed correctly from the URL
- [ ] Ladder repo was renamed or transferred → fork `parent` check compares repo ids, not names
- [ ] Force-push after verification → stored `headSha` is the proof; T014 reads the diff at that SHA, not the branch tip
- [ ] PR merged by squash or rebase → `merged = true` is the rule; `merge_commit_sha` recorded
- [ ] Repo is a fork for L4 "from scratch" → accepted only as a PR path; a repo link that is a fork of the ladder repo → `not-from-scratch`
- [ ] Same artifact URL submitted twice → idempotent; one row

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| artifact verifier module with `verifyL2Branch`, `verifyL4Artifact` (server code area set by T003) | new |
| src/server/level-generator.ts, src/server/save-ladder.ts, src/shared/levels.ts | L1 in `MCQ_LEVELS` / `POOL_LEVELS`; L1 kind `run-mcq` (AC 6) |
| GitHub client from T005 | add compare, pulls, gists calls |
| new migration `0014_artifacts` (0013 is T016's) | artifact table (no L1 nonce table: option B) |
| recorded GitHub fixtures for tests | new |
| tests (bun test + test Postgres) | AC 1–7 |
| `tasks/TASK_REVIEW_T013.md` | Evidence (reviewer) |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `.claude/**`, `agents/**`, `skills/**`, `templates/**`, `AGENTS.md`, `CLAUDE.md` | kit |
| `PRD.md`, `PROJECT_SPEC.md`, `PROJECT_KANBAN.md` | Supervisor-owned |
| `experiments/**` | pattern reference only |
| evidence module and its migration (T012) | call `writeEvidenceRecord`; do not change the record format |
| applied migrations of earlier tasks | add a new migration instead |

---

## Test Plan

Unit (bun test): URL parsing (valid, foreign host, wrong scheme, branch with `/`), 3-sentence rule. Integration (bun test + test Postgres + recorded GitHub fixtures): every AC row and every edge case above. A one-off `bun run record-fixtures:t013` script refreshes fixtures from live GitHub; tests never call the network. Paste `bun test` output into the report.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run
- [ ] Security review: `Skill({ skill: "security-review" })` run (High risk)
- [ ] `Skill({ skill: "migration-safety" })` passed for the new migration
- [ ] Lint passes (`bun run lint`, `bun run typecheck`)
- [ ] Tests written AND pass — output pasted into `tasks/TASK_REVIEW_T013.md` Evidence (Hard-Stop Gate 5)
- [ ] `Skill({ skill: "verify" })` run — headless auto verify
- [ ] Supervisor notified: task ready for Stage 4 review

---

## Questions Log

- 2026-11-19 DEBATE How does L1 pass (the decision this guide asked the user for)? → option B: L1 passes through the MCQ pass test on README/setup chunks; run log and explanation are optional feedback (Advocate 1: option B, MCQs on setup, log/explanation feedback only; Advocate 2: option A, gist with a nonce checked on GitHub; Advocate 3: option B, the smallest change) ⚠ decided for you — please review (the guide's Supervisor recommendation had been A)
