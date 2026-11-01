# TASK_GUIDE — T001: Spike — measure the deterministic core (answer-key check, signed proof, GitHub read)
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
6. C2: `memory/codebase-map.md` does not exist (blank scaffold) — skip it. Read `BRAINSTORMING_LOG.md` (Option B, Edge Case Checklist) and `docs/REQUIREMENT_SOURCE.md` § LLM strategy, § Proof architecture, § Repo to ladder engine, § Alternatives to investigate.

---

## Requirement (Pillar 1 — Adapt the requirement)

User: "init project following [the requirement]. Must evaluation, experiment the solution before apply."
Requirement: the answer-key code check — "the answer key must appear in, or be checkable against, the cited
chunk. A citation alone is not proof" — and "Seed 100 questions with wrong keys and measure the catch rate".
Proof: "The LLM is never in the trust path: every proof is deterministic evidence plus a signature";
"Plain signed JSON for v1". Engine: read README, topics, languages, dependency files, open issues, `good first
issue` labels; pin to a commit SHA; "thin README or no issues means low confidence; fall back to
concept-only ladders".

**Restated intent** (Supervisor's interpretation):
> Before any v1 code, measure with a throwaway, LLM-free TypeScript spike whether (1) a code-only answer-key
> check catches wrong MCQ keys, (2) a SHA-256 + Ed25519 signed evidence record verifies and rejects tampering,
> and (3) the GitHub API gives enough to pin a SHA and score confidence for the 3 v0 repos. Output: numbers in
> `experiments/core-spike/RESULTS.md`, judged against thresholds fixed in this guide.

**Out of scope** (what this task explicitly does NOT do):
- Any LLM call (blind solver, generators, concept mapper) — needs PRD Open Question 5.
- FSRS scheduling (cut: v0 uses Anki's FSRS).
- Any app structure: no server, DB, UI, Inngest, AI SDK. Nothing outside `experiments/core-spike/` and `tasks/TASK_REVIEW_T001.md`.
- Open Badges 3.0 / VC format (v2).

**Requirement Refs**:
- FR-001: GitHub read + SHA pin
- FR-005: confidence score + concept fallback flag
- FR-006: answer-key code check (code-check part only)
- FR-011: evidence record with SHA-256
- FR-012: signed credential — plain signed JSON
- NFR-002: LLM never in the trust path
- NFR-009: rate-limit handling
- PRD Open Question 7 (catch-rate measurement)

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [x] Restated intent confirmed to match the user's request — auto (Supervisor), 2026-11-01
- [x] Domain terms align with `PROJECT_SPEC.md` § Glossary
- [x] Every Acceptance Criterion below traces to a line in the Requirement
- [x] All Requirement Refs exist in `PRD.md` and are covered by the Acceptance Criteria

---

## Dependencies & Reachability

**Depends on**: None
**Entry point**: `pnpm experiment` (script in `experiments/core-spike/package.json`)

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | `checkAnswerKey({ options, key, chunk })` returns `{ pass, reason }`. It passes only when `key` is one of `options` AND the normalised key (NFKC, lower-case, collapsed whitespace) occurs in the normalised chunk at token boundaries. `map` must not match inside `bitmap`; `60` must not match inside `60,000`. | answer-key code check |
| 2 | A seed set `fixtures/mcq-seed.json` holds ≥ 40 original MCQs (4 options each), each grounded in a short chunk from one of the 3 v0 repos' recorded README/docs. Wrong-key variants are derived deterministically: each distractor in turn becomes the key → ≥ 120 seeded wrong keys. | "Seed 100 questions with wrong keys" |
| 3 | The experiment reports **catch rate** (seeded wrong keys rejected / all seeded wrong keys) and **false-reject rate** (correct keys rejected / all correct keys), with counts, and lists every miss. | measure the catch rate |
| 4 | `canonicalJson(value)` is key-order independent (sorted keys, NFC strings, no insignificant whitespace). `hashRecord` hashes the canonical record without `hash` and `signature` fields → `sha256:<hex>`. | evidence record SHA-256 |
| 5 | `signRecord` / `verifyRecord` use Ed25519 from `node:crypto` with a key pair generated in memory per run. Verify passes for the untouched record and fails when any single field of the evidence record example is changed, when `hash` is wrong, or with another public key. | plain signed JSON; LLM not in trust path |
| 6 | `fetchRepoSnapshot(fullName, fetchImpl)` returns `{ sha, defaultBranch, readme, topics, languages, depFiles, openIssues, goodFirstIssues }`. Tests run offline from recorded fixtures for `The-Pocket/PocketFlow`, `developit/mitt`, `lukeed/dset`. | GitHub read + SHA pin |
| 7 | GitHub errors are explicit: 403/429 with `x-ratelimit-remaining: 0` → `RateLimitError` (with reset time); 404 → `RepoNotFoundError`; no README → snapshot with `readme: ""`, not a throw. No partial snapshot is returned on error. | NFR-009 |
| 8 | `confidenceScore(snapshot)` returns `{ score (0–1), level: low|medium|high, fallbackToConcepts: boolean, reasons[] }`. Rule fixed here: README < 1,500 chars → −0.4; 0 open issues → −0.3; 0 `good first issue` → −0.1; no dependency file → −0.2; start 1.0, floor 0. `low` < 0.4 → `fallbackToConcepts: true`; `medium` < 0.7; else `high`. | thin README / no issues → low confidence, fall back |
| 9 | `pnpm experiment` writes `experiments/core-spike/RESULTS.md`: the metrics of AC 3, the proof checks of AC 5, the 3 repos' SHA + confidence, and a verdict per threshold below. | evaluate before apply |

---

## Evaluation & Acceptance

### Pre-registered thresholds (Supervisor oracle — fixed before the first run; do not tune after)

| Experiment | Keep current pick if | Otherwise |
|---|---|---|
| Answer-key code check | catch rate ≥ 90% AND false-reject rate ≤ 10% | Record "code check alone is insufficient: blind solver or entailment check required" (§ Alternatives: Question checking) |
| Signed proof | 100% of tamper cases fail verify AND untouched record verifies | Record "plain signed JSON not viable as specified" |
| GitHub read | all 3 repos give a SHA + snapshot in ≤ 20 API calls each | Record "needs token / different source" |

The tests assert correctness of the code and the metric arithmetic. They do **not** assert that the
thresholds are met: a failed threshold is a valid experimental result and goes in RESULTS.md as such.

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | Hand-made pairs: key `map` / chunk `uses a bitmap`; key `60` / chunk `limit is 60,000` | `pass: false` | vitest |
| 2 | 4 hand-made MCQs with known outcomes + 3 derived wrong keys each | metric function returns the exact counts | vitest |
| 3 | Evidence record example from `docs/REQUIREMENT_SOURCE.md` § Diagram text, keys shuffled | same `hash` | vitest |
| 4 | Signed record with `level` changed `L2`→`L3` | `verifyRecord` → false | vitest |
| 5 | Mocked fetch returning 403 + `x-ratelimit-remaining: 0` | throws `RateLimitError` | vitest |
| 6 | Recorded fixture for `lukeed/dset` | snapshot with 40-hex `sha`, confidence object with reasons | vitest |
| 7 | `pnpm experiment` | RESULTS.md exists with 3 verdict lines | command run |

### Verification Command (exact, runnable)

```bash
cd experiments/core-spike && pnpm install --frozen-lockfile && pnpm test && pnpm experiment && cat RESULTS.md
```

### Evidence (filled by reviewer at Stage 4/5)

> Filled by the reviewer at Stage 4/5 in `tasks/TASK_REVIEW_T001.md`.

---

## Demonstration

> See `tasks/TASK_REVIEW_T001.md`.

---

## Approach

**Pattern reference**: `None — no comparable prior art in this repo` (blank scaffold; kit code is Python hooks, not app code)

**Vital slice**: the answer-key check + its catch-rate measurement (the one bet the source marks untested).
**Cut list**:
- FSRS spike (v0 uses Anki's FSRS)
- blind solver / any LLM (no provider decided)
- embedding dedupe (needs a model)
- live GitHub calls in tests (fixtures only; `pnpm record-fixtures` refreshes them, run once)

Layout: `experiments/core-spike/{package.json, pnpm-lock.yaml, tsconfig.json, src/keycheck.ts, src/proof.ts,
src/github.ts, src/confidence.ts, src/run-experiment.ts, scripts/record-fixtures.ts, fixtures/**, test/*.test.ts,
RESULTS.md}`. TypeScript run with `tsx`; tests with `vitest`. Pin every dependency to an exact version
published at least 2 weeks before 2026-11-01 (e.g. not `ts-fsrs@6.0.0`-style fresh releases). No runtime deps
beyond Node built-ins if possible. Record fixtures with unauthenticated GitHub API calls (limit 60/h —
budget ≤ 20 calls per repo; check `x-ratelimit-remaining` first). MCQs and their chunks: write questions
yourself (original text); chunks are short quotes (≤ 300 chars) from the recorded README/docs with the source
path and SHA. Ed25519 keys: `generateKeyPairSync('ed25519')` per run; never write a private key to disk.

---

## Edge Case Checklist

- [ ] Key matches only after whitespace/case normalisation → passes
- [ ] Key is a substring of a longer token (`map` in `bitmap`) → fails
- [ ] Numeric keys (`60` vs `60,000`) → fails
- [ ] Key present but in a negated sentence → document as a known limit in RESULTS.md (do not solve)
- [ ] Key not in `options` → fails with reason `key-not-in-options`
- [ ] JSON key order does not change the hash; Unicode NFC vs NFD strings hash the same
- [ ] `hash` and `signature` fields excluded from the hash input
- [ ] 403/429 rate limit, 404, no README, default branch not `main` (`lukeed/dset` uses `master`)
- [ ] Tests never hit the network

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| `experiments/core-spike/**` | new throwaway spike |
| `tasks/TASK_REVIEW_T001.md` | Evidence (reviewer) |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `.claude/**`, `agents/**`, `skills/**`, `templates/**`, `AGENTS.md`, `CLAUDE.md` | kit |
| `PRD.md`, `PROJECT_SPEC.md`, `BRAINSTORMING_LOG.md`, `PROJECT_KANBAN.md` | Supervisor-owned |
| `docs/archive/**` | another project's archived board |
| `experiments/v0-kit/**` | T002 |

---

## Test Plan

vitest unit tests per module (AC 1–8) on fixtures and hand-made cases; `pnpm experiment` as the real run
(AC 9). Paste `pnpm test` output and RESULTS.md into the report.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run
- [ ] Security review: `Skill({ skill: "security-review" })` run (Medium risk)
- [ ] Lint passes (`tsc --noEmit`)
- [ ] Tests written AND pass — output pasted into `tasks/TASK_REVIEW_T001.md` Evidence (Hard-Stop Gate 5)
- [ ] `Skill({ skill: "verify" })` run — headless auto verify
- [ ] Supervisor notified: task ready for Stage 4 review
