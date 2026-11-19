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
- **Tech stack**: v0 spikes: TypeScript on Node v26, pnpm, vitest, node:crypto (Ed25519, SHA-256); no storage, no hosting. v1 target (stack decided 2026-11-12; Gate 1 waived by the user 2026-11-12): Bun (server, package manager, test runner), React + Vite (client, PWA), Postgres + pgvector, Vercel AI SDK, Inngest, FSRS. Model A generation: the owner's Claude subscription (`claude -p`) while only the owner generates, an API key before any other learner does; model B is a separate blind Claude call on the same subscription and there is no embedding model (user 2026-11-19, `memory/decisions.md`; replaces the 2026-11-12 rule that model B and embeddings use API keys). Inngest on Bun is unproven until T003's smoke check
- **Main flow**: docs/MAIN_FLOW.md
- **Approved by**:
- **Waived**: user 2026-11-12 — owner chose to start v1 before the 14-day v0 run (Gate 1) ends; Stage 0.5 approval of BRAINSTORMING_LOG.md is still not recorded

---

## Critical Constraints

- The LLM never decides a pass, never schedules a review, never sits in the proof trust path (§ LLM strategy, § Proof architecture).
- No shared database, login or API with Idea Radar; the only contract is `/start?url=` (§ Architecture).
- Gate 1 (v0: review on ≥10 of 14 days, ladders usable) was waived by the user on 2026-11-12 so v1 work may start. v2 and v3 still wait for Gate 2 and Gate 3 (§ Roadmap).
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
| claude | `claude` | haiku-5-5 | sonnet-5-5 | sonnet-5-5 or opus-5-5 | opus-5-5 |

> Set by the Supervisor on 2026-11-12 (user: "supervisor should evaluate and set that"). C2: Sonnet when
> Risk is Low, Opus when Risk is Medium or High. C3 always Opus. Model ids: `claude-haiku-5-5`,
> `claude-sonnet-5-5`, `claude-opus-5-5`.

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
| 2026-11-12 | Ladder unlock is one pure rule (`levelLockState`); passes arrive through an injected seam until T012. Gate 5 needs an attributed `npm run test` call in the task trace. | T010 |
| 2026-11-12 | Review schedule is computed only on the server (`scheduleNext`, fuzz off) and every rating is an append-only log row, so the log replays to the stored card state; `reviewed_at` never goes before `last_review`. | T011 |
| 2026-11-12 | Offline ratings sync through the same `rateCard` path as online ones (client `reviewedAt` only inside a 5-minute window); import never writes card state, only replays newer log rows, so the log always replays to the stored state. | T015 |
