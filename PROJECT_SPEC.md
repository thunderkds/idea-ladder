# PROJECT_SPEC.md
**Last updated**: 2026-11-01
**Version**: 1.0

> **Scope of this document**: *How* to build it safely. Product intent lives in `PRD.md`.

---

## Project Identity

- **Name**: Idea Ladder (working name, PRD Open Question 3)
- **Repo**: local path `/home/hungnguyenhuu/workspace/pets/hungnguyen111/idea-ladder` (no remote yet)
- **Primary tech**: TypeScript end to end (`docs/REQUIREMENT_SOURCE.md` § Framework stack)
- **Type**: PWA + background workflow API (v1); v0 is a zero-code experiment kit
- **Deployment target**: none yet (v1 decides)
- **Key stakeholders**: Hung NguyenHuu (owner, first learner)

---

## Architecture Summary

v1 (target, from the requirement): a fixed durable workflow (Inngest steps) — fetch repo (code) → bounded
read-only repo reader (AI SDK tool loop) → concept mapper → parallel level generators → code checks →
blind solver (other provider) → save ladder `unverified`. Postgres + pgvector store chunks, ladders,
progress and evidence. FSRS schedules reviews; code-only verifiers gate levels; evidence records are
SHA-256 hashed and credentials are signed. The LLM is never in the trust path.
v0 (now): no product code. Experiments only — the v0 ladder kit (T002) and a deterministic-core spike
(T001) that measures the parts v1 depends on before anything is applied.

---

## Readiness

- **Requirements**: PRD.md (source: docs/REQUIREMENT_SOURCE.md)
- **Direction**: BRAINSTORMING_LOG.md (auto mode — Option B narrowed; report reports/thinking-report_plan-idea-ladder-init_20261101T090447.html)
- **Codebase map**: none — blank scaffold
- **Tech stack**: v0 spikes: TypeScript on Node v26, pnpm, vitest, node:crypto (Ed25519, SHA-256); no storage, no hosting. v1 target (unconfirmed until Gate 1): Vercel AI SDK, Inngest, Postgres + pgvector, FSRS, PWA
- **Main flow**: docs/MAIN_FLOW.md
- **Approved by**:
- **Waived**:

---

## Critical Constraints

- The LLM never decides a pass, never schedules a review, never sits in the proof trust path (§ LLM strategy, § Proof architecture).
- No shared database, login or API with Idea Radar; the only contract is `/start?url=` (§ Architecture).
- No v1 product code before Gate 1 (v0: review on ≥10 of 14 days, ladders usable) passes (§ Roadmap).
- Spikes live under `experiments/` and are throwaway: no production abstractions, no persistence beyond files.
- Never commit secrets or private keys; spike signing keys are generated per run in memory.
- Cards are original text; never copy repo code or docs into cards (§ Grill #9).

---

## Known Risk Areas

| Area | Risk Level | Reason | Files |
|------|-----------|--------|-------|
| Proof signing + evidence hashing | Med | Trust path; a canonicalisation bug makes proofs unverifiable | `experiments/core-spike/src/proof*` |
| Answer-key code check | Med | A false pass lets wrong MCQs gate levels | `experiments/core-spike/src/keycheck*` |
| GitHub API reading | Low | Unauthenticated rate limit (60 req/h) | `experiments/core-spike/src/github*` |

---

## Sub-Agent Team

| Agent | Role | CLI Spawn Command |
|---|---|---|
| Common-Infrastructure-Agent | Env setup, worktrees, deps | `Agent({ subagent_type: "common-infrastructure", prompt: "..." })` |
| Backend-Implementer | Spike code (TypeScript, Node) | `Agent({ subagent_type: "backend-developer", prompt: "..." })` |
| Frontend-Implementer | UI (none until v1) | `Agent({ subagent_type: "frontend-developer", prompt: "..." })` |
| QA-Automation-Agent | Independent AC verification | `Agent({ subagent_type: "qa-expert", prompt: "..." })` |

---

## CLI Model Table

| CLI | Run command | C0 | C1 | C2 | C3 |
|---|---|---|---|---|---|
| claude | `claude` | | | | |

> Auto mode (2026-11-01): the user did not list CLIs or models. Cells stay empty; spawns use the CLI and
> model this session runs as (`docs/claude-md/tracks.md` § Auto mode row 14).

---

## Glossary

- **Ladder**: levels L0 Prerequisites → L4 Rebuild or contribute for one repo (or concept).
- **Concept ladder**: a ladder for a reusable concept, shared across repos.
- **Pass test**: the deterministic check that unlocks a level; never an LLM judgment.
- **Evidence record**: one append-only, SHA-256-hashed record per passed level.
- **Answer-key code check**: the code check that an MCQ's key appears in, or is checkable against, its cited chunk.
- **Seeded wrong key**: a deliberately wrong answer key used to measure the code check's catch rate.

## Tasks

See `PROJECT_KANBAN.md`.

---

## Memory / Insights

| Date | Insight | Source Task |
|------|---------|------------|
