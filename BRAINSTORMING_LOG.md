# BRAINSTORMING_LOG.md
**Generated**: 2026-11-01
**Task / Context**: Phase 0 → Stage 0.5b for Idea Ladder (v0 phase). Tier: Standard.
**Skill**: `Skill({ skill: "brainstorming" })` — auto mode; direction settled by a 2-Advocate Debate.

---

## The Problem Space

The user asked to init Idea Ladder from the requirement and to **evaluate and experiment before applying**.
The requirement's roadmap already makes v0 the experiment: "No code, 2 weeks; 3 hand-made ladders; Anki
as the app", gated by "Review on 10 of 14 days and ladders usable" (`docs/REQUIREMENT_SOURCE.md` § Diagram
text). v0 tests the habit and ladder quality. It does not test the v1 trust-path bets: the answer-key code
check ("A citation alone is not proof") and deterministic signed proof. The blind solver is "Design choice,
not yet tested".

Non-negotiable: no v1 product code before Gate 1 (`PRD.md` § Out of Scope). The LLM is never in the trust
path. Environment facts (checked 2026-11-01): no LLM API key in env; `gh` not logged in; GitHub API
unauthenticated works (limit 60/h); node v26, pnpm, `claude` CLI exist; `ts-fsrs` latest stable 5.4.2
(2026-09-01), 6.0.0 only 4 days old.

---

## Questions for the User

Auto mode: none asked. The v1 open decisions (`PRD.md` Open Questions 1–6) stay open: they do not change
what v0 builds.

---

## Alternative Paths

| Option | Name | Summary | Invasiveness | Code Volume | Regression Risk | Recommended? |
|--------|------|---------|-------------|------------|----------------|--------------|
| A | The Minimalist Path | v0 exactly as written: 3 ladders + Anki import file + 14-day log; no code | Low | 0 lines | Low | |
| B | The Measured Path | A + a throwaway deterministic spike (no LLM) on the trust-path bets | Low | ~400 lines, under `experiments/` | Low | ✅ Yes (narrowed) |
| C | The Scalable Path | Full LLM pipeline prototype (AI SDK + Inngest, model A + model B) on a golden set | High | ~2,000+ lines | Medium | |

### Option A — Minimalist
**Approach**: Generate 3 ladders with the `claude` CLI, export cards as an Anki-importable file, give a 14-day log.
**Pros**: Literal match to § First experiment; zero sunk cost before Gate 1.
**Cons**: Produces no measurement of the technical bets; the user's "experiment before applying" is only half met.
**Why it might fail**: Gate 1 passes, v1 starts, and the key check or proof format fails late in v1.

### Option B — Measured (narrowed by the Debate)
**Approach**: A, plus `experiments/core-spike` (TypeScript, throwaway) with pre-registered thresholds:
1. Answer-key code check on seeded wrong keys → catch rate and false-reject rate (§ Alternatives: "Seed 100 questions with wrong keys and measure the catch rate").
2. Evidence record SHA-256 + signed JSON (Ed25519, canonical JSON) → verify passes, any tamper fails.
3. GitHub read + SHA pin + confidence score on the 3 v0 repos, from recorded fixtures (tests run offline).
**Cut**: FSRS spike — v0 already uses Anki's FSRS (Advocate 2). Blind solver — needs a model (Open Question 5).
**Pros**: Measures the bets that can be measured without a provider; reuses the v0 repos as inputs.
**Cons**: Seeded wrong keys are synthetic → the catch rate is an upper bound; the report must say so.
**Why it might fail**: Scope creep into v1 scaffolding. Guard: everything stays under `experiments/`, no app structure.

### Option C — Scalable
**Approach**: Build the v1 workflow now and evaluate on ~20 golden repos.
**Cons / why it fails**: No API keys; provider and cost cap unanswered (Open Question 5); golden set does not exist; violates "no v1 before Gate 1". Results would be mocked → false confidence.

---

## 50% Rule Check

Half the code: drop the GitHub reader and keep only the key check + proof signing (~200 lines). Kept the
reader only because it reads the 3 v0 repos once into fixtures that T002's ladders also cite, and FR-005's
confidence score has no other test. FSRS was cut entirely.

---

## Recommended Path

**Option B — Measured, narrowed.** T001 = deterministic-core spike (key check, proof, GitHub read). T002 =
v0 ladder kit. Neither is product code. The v1 build is planned only after Gate 1 and the T001 numbers.

v0 repos (taste; confirmed by user 2026-11-01, "keep the current repos"): trending `The-Pocket/PocketFlow` (11.3k★, Python, rising LLM topic),
medium `developit/mitt` (11.9k★, TypeScript, tiny core), lowkey `lukeed/dset` (783★, JavaScript, thin docs —
exercises the concept fallback).

---

## Surgical Scope

Files that **should** be touched: `experiments/core-spike/**` (T001), `experiments/v0-kit/**` (T002),
`tasks/TASK_REVIEW_T00{1,2}.md`, `PROJECT_KANBAN.md`, `PROJECT_SPEC.md`.

Files that **must not** be touched: `.claude/**`, `agents/**`, `skills/**`, `templates/**`, `AGENTS.md`,
`CLAUDE.md` (kit); `docs/archive/**` (other project's board).

---

## Edge Case Checklist for TASK_GUIDE

- [ ] Key check: key matches only after whitespace/case normalisation; key is a substring of a longer token (`map` in `bitmap`) → must not pass.
- [ ] Key check: numeric keys (`60` vs `60,000`); key present in chunk but in a negated sentence (document as a known limit).
- [ ] Proof: key order in JSON must not change the hash (canonical JSON); Unicode normalisation; tamper of one field fails verify.
- [ ] Proof: `hash` field excluded from its own hash input; signature over the hash, not the pretty-printed text.
- [ ] GitHub: rate limit (403/429 with `x-ratelimit-remaining: 0`) → clear error, no partial ladder (NFR-009); 404 repo; repo with no README; default branch not `main`.
- [ ] Tests run offline from recorded fixtures; a live refresh script is separate.
- [ ] Ladder kit: cards are original text; never paste repo code into cards (NFR-006).

---

## Next Actions

1. Stage 2: write `TASK_GUIDE_T001.md` (spike, C2, Risk Medium) and `TASK_GUIDE_T002.md` (v0 kit, C1, Risk Low).
2. Stage 3: T001 → backend-developer; T002 → backend-developer (content + small export script).
3. After T001: record the numbers as a DDR input for v1 "Question checking" and "Proof format".

---

## User Selection

> **Approved direction**: Option B — Measured (narrowed). Auto mode: taken by the Supervisor after a 2-Advocate Debate, not approved by the user.
