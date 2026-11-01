# PRD — Idea Ladder
**Last updated**: 2026-11-01
**Status**: Draft (auto mode — not approved by the user) · PRD gate: PASS for v0 scope (grill 2026-11-01); 2 items flagged for v1
**Owner**: Hung NguyenHuu

> **Scope of this document**: *What* to build and *why*. Technical decisions live in `PROJECT_SPEC.md`.
> Source: `docs/REQUIREMENT_SOURCE.md` (snapshot of the Claude Docs requirement "Idea Ladder — Vision, Grill & Flow").
> Every row below cites its source section in that file as `§ <heading>`.

---

## Overview

A developer finds an interesting repo, stars it, and never comes back. Tutorials are passive, and AI chat
gives a learning path but forgets the learner. Idea Ladder turns a pasted GitHub repo (or any URL) into a
leveled ladder, L0 Prerequisites → L4 Rebuild or contribute. The learner reviews 5 minutes a day and unlocks
each level only by passing its test. Each passed level leaves deterministic, signed proof. The core value is
**persistence and proof, not content** (§ Vision). The roadmap is gated: v0 validates the idea with no code
before v1 builds the MVP PWA (§ Roadmap, § First experiment and kill criteria).

---

## Personas

| ID | Name | Role | Pain Point |
|----|------|------|-----------|
| P1 | Repo learner (first user = the owner) | Developer who finds an interesting repo | Starred repos are never revisited; tutorials are forgotten in days; AI chat forgets them; no way to show what they learned (§ Problem and first user) |
| P2 | Proof checker | Anyone (hiring manager, peer) who opens a proof link | Cannot tell whether a learner really did the work without trusting the app's AI (§ Proof architecture) |
| P3 | Ladder author (v2+) | Expert who improves a shared concept ladder | No reason to contribute; no credit (§ Grill #5) |

---

## User Stories

| ID | Story | Persona |
|----|-------|---------|
| US-001 | As P1, I want to paste a repo URL (or open `/start?url=`) and get a ladder L0–L4, so that a star becomes a path. | P1 |
| US-002 | As P1, I want a 5-minute daily review scheduled for me, so that I keep what I learned. | P1 |
| US-003 | As P1, I want a level to unlock only after I pass its test, so that I cannot skip gaps. | P1 |
| US-004 | As P1, I want questions generated from my own diff, so that the test proves I understand my change. | P1 |
| US-005 | As P1, I want to review offline and get push reminders, so that I review anywhere. | P1 |
| US-006 | As P1, I want a proof record per passed level and a credential at ladder completion, so that I can show what I learned. | P1 |
| US-007 | As P2, I want a public verify page that checks the signature and re-checks GitHub evidence live, so that I trust the proof without trusting the AI. | P2 |
| US-008 | As P1, I want to flag a question that seems wrong, so that bad cards get fixed. | P1 |
| US-009 | As P1 (owner), I want to validate the idea in 2 weeks with no code, so that I do not build a product nobody uses. | P1 |

---

## Functional Requirements

| ID | Requirement | Traces to |
|----|-------------|-----------|
| FR-001 | The system must read a GitHub repo through the GitHub API (README, topics, languages, dependency files, open issues, `good first issue` labels) and pin it to a commit SHA (§ Repo to ladder engine). | US-001 |
| FR-002 | The system must map a repo to 3–6 concepts; the learner can edit the mapping (§ Repo to ladder engine, § LLM strategy). | US-001 |
| FR-003 | The system must reuse an existing concept ladder or draft a missing one marked `unverified` (§ Repo to ladder engine). | US-001 |
| FR-004 | The system must generate the repo-specific levels L1–L4 with the pass tests in § Repo to ladder engine (L1 screenshot/log + 3-sentence explanation; L2 branch/diff + diff questions; L3 verified MCQs; L4 repo or merged PR). | US-001, US-003 |
<!-- FLAGGED (v1 only): L1 proof (screenshot/log + explanation) has no code verifier in § Proof architecture — define how L1 passes before v1 planning. Does not block v0. -->
| FR-005 | The system must compute a confidence score (thin README or no issues = low) and fall back to concept-only ladders when low (§ Repo to ladder engine). | US-001 |
| FR-006 | Every generated question must pass the verification pipeline: grounded chunks only; answer key present in / checkable against the cited chunk (code check); blind solve by a different model, mismatch = discard; near-duplicate removal by embedding similarity; learner flag (§ LLM strategy). | US-003, US-008 |
<!-- FLAGGED (v1 only): "different model" depends on PRD Open Question 5 (AI provider). T001 measures the code check without any model. Does not block v0. -->
| FR-007 | Level unlock and review scheduling must be deterministic code (FSRS); an LLM never decides a pass (§ LLM strategy). | US-002, US-003 |
| FR-008 | Open-answer AI grading must be feedback only and never gate a level (§ LLM strategy). | US-003 |
| FR-009 | After L2 the system must generate questions from the learner's own diff (§ LLM strategy, § Sequence: pass test and proof). | US-004 |
<!-- RESOLVED (FACT): diff-question pass threshold = 4 of 5, from the evidence record example `"diffQuestions": { "asked": 5, "correct": 4, "pass": 4 }` (docs/REQUIREMENT_SOURCE.md § Diagram text). -->
| FR-010 | Verifiers must be code only: MCQ scored against stored keys; artifact exists, author matches the signed-in GitHub account, commit SHA recorded, PR merged state (§ Proof architecture). | US-003, US-006 |
| FR-011 | Each passed level must write one append-only evidence record with a SHA-256 hash of its contents (§ Proof architecture). | US-006 |
| FR-012 | Ladder completion must issue a signed credential (plain signed JSON in v1, Open Badges 3.0 at v2) with a revocation status entry (§ Framework stack, § Proof architecture). | US-006 |
<!-- DEFERRED (implementation): signature algorithm and JSON canonicalisation for "plain signed JSON" are mechanism, not user-facing → decided in brainstorming / T001 (Phase 0 Step 1.5 rule 2). -->
| FR-013 | A public verify page must check the signature and re-check GitHub evidence live (§ Proof architecture). | US-007 |
| FR-014 | The PWA must work offline and send push reminders (§ Brainstorm: feature ideas — MVP). | US-005 |
| FR-015 | The only contract with Idea Radar is `https://<ladder-app>/start?url=<repo or any URL>`; hand-pasted URLs also work (§ Architecture). | US-001 |
| FR-016 | Anti-cheat: MCQs drawn from a randomized pool; retakes rate-limited (§ Proof architecture). | US-003 |
| FR-017 | v0: a zero-code experiment kit — 3 ladders (trending, medium, lowkey repo) in the L0–L4 template, cards importable into Anki (FSRS on), and a 14-day log with the kill criteria (§ First experiment and kill criteria). | US-009 |
<!-- FLAGGED → auto decision: the source says "Pick 3 repos from Idea Radar", but Idea Radar is not in this repo. Repo choice is decided in brainstorming and logged ⚠ in tasks/TASK_REVIEW_T002.md. -->

---

## Non-Functional Requirements

| ID | Requirement | Category |
|----|-------------|----------|
| NFR-001 | The API answers ladder requests in milliseconds; generation runs in the background and notifies the PWA (§ Sequence: ladder generation). | Performance |
| NFR-002 | The LLM is never in the trust path: every proof is deterministic evidence + signature, re-checkable by anyone (§ Proof architecture). | Security / Integrity |
| NFR-003 | Every artifact must belong to the GitHub account signed in by OAuth (§ Proof architecture). | Security |
| NFR-004 | Ladders are cached by repo + commit SHA; the first learner pays generation, later learners reuse (§ Framework stack, § Grill #8). | Cost |
| NFR-005 | Each workflow step is durable and retried on its own, without re-paying earlier LLM calls (§ Framework stack). | Reliability |
| NFR-006 | Cards are original text only; repo code and docs are linked, not copied (§ Grill #9). | Legal |
| NFR-007 | Progress syncs to the backend and supports export/import, because iOS can clear PWA storage (§ Grill #11). | Durability |
| NFR-008 | Prompt regressions are caught on a golden set of ~20 hand-checked repos before learners see them (§ Framework stack). | Quality |
| NFR-009 | GitHub API reads must respect rate limits (60 req/h unauthenticated, 5,000 req/h with a token) and degrade to a clear error, not a partial ladder. (Added at grilling: implied by § Repo to ladder engine reading 6 resource types per repo.) | Reliability |

---

## Success Metrics / KPIs

| Metric | Baseline | Target | How measured |
|--------|----------|--------|--------------|
| v0 daily review | none | review on ≥10 of 14 days without forcing | v0 daily log (§ First experiment) |
| v0 ladder quality | none | trending + medium ladders usable with light edits; lowkey usable via concept fallback | v0 daily log |
| v0 pass tests | none | ≥1 level felt genuinely earned | v0 daily log |
| v0 pull | none | owner wants a "Learn this" button in Idea Radar | v0 daily log |
| Gate 2 (after v1) | none | other learners finish L1 without help | v1 usage |
| Gate 3 (after v2) | none | proof links get shared; first outside ladder PR | v2 usage |

---

## Out of Scope

- Explaining the repo with an LLM — link to README, docs or DeepWiki instead (§ LLM strategy).
- Multi-agent orchestration, handoffs, parallel writer agents, LangGraph, OpenAI Agents SDK (§ LLM architecture, § Framework stack).
- Any shared database, login or API with Idea Radar (§ Architecture).
- v2/v3 features until their gates pass: community ladders repo, author credit, cohorts, trending pick, Anki export, paid certificates (§ Brainstorm, § Roadmap).
- Building the v1 MVP before Gate 1 (v0) passes (§ Roadmap).

---

## Open Questions / Assumptions

All rows below come from § Open decisions and § Grill #12 of the source. None changes what v0 builds, so
they stay open (Phase 0 Step 1.5 materiality heuristic). They must be answered before v1 planning.

| # | Question / Assumption | Owner | Due |
|---|----------------------|-------|-----|
| 1 | Goal: portfolio/learning project, or a product meant to grow users? | Hung | before v1 |
| 2 | Core value (pick one): review habit, proof of skill, or community ladders? | Hung | before v1 |
| 3 | Name: keep "Idea Ladder"? | Hung | before v1 |
| 4 | ~~Backend~~ **Resolved 2026-11-01 by user: accounts from day one** (GitHub OAuth; progress, reviews, evidence in Postgres). | Hung | done |
| 5 | ~~AI provider~~ **Resolved 2026-11-01 by user: Claude generates (model A); a second provider blind-solves (model B).** Cost cap: user asked why ladders cost money → not set; v1 task measures real cost per ladder on the golden set first. | Hung | cap after measurement |
| 6 | Open source from v0, or only the ladder content repo at v2? | Hung | before v1 |
| 7 | Assumption: the blind-solver check catches wrong keys — "Design choice, not yet tested" (§ LLM strategy). Measured by spike T001. | Supervisor | T001 |
