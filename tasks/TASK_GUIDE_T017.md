# TASK_GUIDE — T017: Measure real cost per ladder on the golden set; set and enforce a cap with the user; provider prompt caching
**Date**: 2026-11-01
**Complexity Level**: C1
**Risk Level**: Medium
**Priority**: P1
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
6. C1: read `memory/codebase-map.md` only to find the generation workflow (T005–T009) and T004's eval harness and cost log. Read `docs/REQUIREMENT_SOURCE.md` § Framework stack (rows "Cache", "Tracing and evals"), § Grill #8, § Alternatives to investigate (row "Models"), § Open decisions; `PRD.md` Open Question 5.

---

## Requirement (Pillar 1 — Adapt the requirement)

Source:
- `docs/REQUIREMENT_SOURCE.md` § Open decisions: "AI provider and cost cap per ladder".
- § Framework stack, row "Cache": "Ladders keyed by repo + commit SHA; provider prompt caching — First learner pays generation; everyone after reuses".
- § Grill #8: "AI cost per ladder? — Cache by repo + SHA; concept ladders reused across repos — High".
- § Alternatives to investigate, row "Models": "How to test — Cost and accuracy per step on the golden set — Switch if — Cost per ladder too high, or accuracy gap is small".
- `PRD.md` Open Question 5: "Cost cap: user asked why ladders cost money → not set; v1 task measures real cost per ladder on the golden set first."
- User decision 2026-11-01: cost cap per ladder is not set; this task measures cost, then sets the cap with the user.

**Restated intent** (Supervisor's interpretation):
> Run the real generation workflow on T004's golden set and report the measured cost per ladder and per step, cold and with provider prompt caching on. Show the numbers to the user, record the cap the user picks, and make the workflow stop cleanly when one ladder's spend would pass that cap.

**Out of scope** (what this task explicitly does NOT do):
- Changing model A or model B, or prompts, to cut cost (a later decision from these numbers).
- Per-learner billing, quotas or payments.
- Cost of diff questions (T014) — measured only if T014 is merged; otherwise listed as not measured.
- A cost dashboard (the report file is the output).

**Requirement Refs** (FR/NFR/US IDs from `PRD.md` this task satisfies):
- NFR-004: cache by repo + SHA; provider prompt caching (first learner pays)
- NFR-008: golden set of ~20 hand-checked repos used for measurement
- NFR-005: a cap stop must not re-pay or corrupt earlier durable steps
- PRD Open Question 5 (cost cap)

### Decision needed from the user

**Question**: After seeing the measured cost per ladder (median, p95, max), which cap rule do you want?

| Option | Rule | Trade-off |
|---|---|---|
| A — Hard cap from data | Cap = measured p95 × 1.5 (or a round number you name). A ladder that would pass it stops with status `cost-cap-reached`; no ladder is saved. | Predictable spend; a big repo can fail to get a ladder. |
| B — Hard cap + concept fallback | Same cap; on reaching it, the workflow saves a concept-only ladder (the low-confidence path of FR-005) from what it already has. | Learner still gets a path; more code paths to test. |
| C — Soft cap | No stop; log and alert the owner when a ladder passes the cap. | Never blocks a learner; spend is unbounded. |

Supervisor recommendation: A, with the cap value the user names after reading the report. **The agent stops with `Status: blocked` + `Question:` until the user answers.** The agent may finish AC 1–4 (measurement and caching) first, then stops before AC 5–6; it writes the user's answer into `docs/COST_REPORT.md` § Decision.

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [ ] Restated intent confirmed to match the user's request (by Supervisor / user — not the implementing agent)
- [ ] Domain terms align with `PROJECT_SPEC.md` glossary (`grill-with-docs` run if terminology was fuzzy)
- [ ] Every Acceptance Criterion below traces to a line in the Requirement
- [ ] All Requirement Refs exist in `PRD.md` and are fully covered by the Acceptance Criteria above

> An agent must NOT start implementing until this gate is checked. If anything here is unclear,
> STOP and ask the Supervisor (Karpathy: Think Before Coding).

---

## Dependencies & Reachability

**Depends on**: T009 — the complete generation workflow (reader, concept mapper, generators, code checks, blind solver) whose cost is measured; T004 — the golden set of 20 repos, the eval harness and the per-step cost log.
**Entry point**: `pnpm cost:measure` (script) and `enforceCostCap` (called inside each LLM step of the generation workflow)

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | `pnpm cost:measure` runs the generation workflow on all 20 golden-set repos, twice: run 1 with an empty ladder cache and no prompt cache warm, run 2 right after with prompt caching on. Per-step cost = tokens from the provider usage response × the price in `pricing.json`. | "Cost and accuracy per step on the golden set" |
| 2 | `docs/COST_REPORT.md` shows, per run: median, p95 and max cost per ladder in USD, cost per step (reader, concept mapper, generators, blind solver), input / output / cached tokens, and the ladder-quality score of T004's harness, so cost and accuracy sit side by side. | "Cost per ladder too high, or accuracy gap is small" |
| 3 | `pricing.json` lists each model's input, output, cache-write and cache-read price per million tokens, with the provider pricing page URL and the date read. Cost code never contains a price literal. A model with no `pricing.json` entry fails the run with `missing-price:<model id>`. | measured, not assumed |
| 4 | Provider prompt caching is on for model A: the stable prefix (system prompt + repo context) is marked cacheable through the AI SDK provider options; run 2 shows cache-read tokens > 0 for model A steps. For model B (second provider, chosen in T009), caching is used if the provider supports it, else the report says "not supported". | "provider prompt caching" |
| 5 | (After the user's answer) the cap value and rule are stored in config (`COST_CAP_USD_PER_LADDER`). `enforceCostCap` runs before each LLM step with the spend so far plus the step's estimated maximum cost (max output tokens × price); if that passes the cap, the workflow ends with status `cost-cap-reached` (option A) and saves no partial ladder. | "cost cap per ladder" |
| 6 | Boundary: spend + estimate exactly equal to the cap → allowed; 1 cent above → stopped. A cache hit on repo + SHA costs 0 and is never counted against the cap. | cap enforcement; "First learner pays generation" |

---

## Evaluation & Acceptance (How we know the agent worked correctly)

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | Fake usage `{ input: 1,000,000, output: 0 }` and a test `pricing.json` with input price 3.00 | cost 3.00 USD | vitest |
| 2 | Model id absent from `pricing.json` | run fails `missing-price:<model id>` | vitest |
| 3 | Cap 0.50 USD; mock steps costing 0.20, 0.20, then a step estimated 0.11 | workflow stops before the 3rd LLM call; status `cost-cap-reached`; no ladder row | integration test (Inngest test engine, mock models) |
| 4 | Cap 0.50; spend 0.39 + estimate 0.11 | step runs | vitest |
| 5 | Second `/start` for the same repo + SHA | cache hit; cost log shows 0; cap not consulted | integration test |
| 6 | Real run on the golden set (API keys in env) | `docs/COST_REPORT.md` with both runs, all 20 repos, cache-read tokens > 0 in run 2 | command run (manual, recorded in review) |

### Verification Command (exact, runnable)

```bash
# describe blocks of this task start with "T017"; the suite uses mock models and fixtures
pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test -- -t "T017"
# ci: skip — real-cost run: needs model A and model B API keys and spends real money; run once by hand, output goes in the review
pnpm cost:measure && cat docs/COST_REPORT.md
```

### Evidence (filled by reviewer at Stage 4/5)

> **Moved.** Filled by the reviewer at Stage 4/5 in `tasks/TASK_REVIEW_T017.md`.

---

## Demonstration

> **Moved.** See `tasks/TASK_REVIEW_T017.md`.

---

## Approach

**Pattern reference**: T004's per-step cost log and eval harness — reuse its log rows as the measurement source, do not add a second logger; `experiments/core-spike/src/report.ts` — a script that writes a results markdown file with pre-registered thresholds and known limits.

**Vital slice**: the measured cost per ladder (cold vs cached) on the golden set, shown to the user.
**Cut list**:
- automatic model switching when cost is high
- per-learner or per-day caps
- currency other than USD
- options B and C of the decision (built only if the user picks them)

Before the real run, print the expected maximum spend (20 repos × 2 runs × the T004 per-ladder estimate) and stop if no T004 estimate exists; the Supervisor confirms the run with the user. Read prices from the providers' public pricing pages on the day of the run; write the URL and date into `pricing.json`. Use the AI SDK's provider options for cache control on model A's stable prefix; keep the variable part (chunk text, level) after the cache breakpoint. `docs/COST_REPORT.md` ends with a "Known limits" list (20 repos is a small sample; prices change; run 2 cache hits depend on the provider cache lifetime). Cap state lives in the workflow run (spend so far from the cost log), so a retried step does not double-count: count a step's cost once, keyed by step id.

---

## Edge Case Checklist

- [ ] A step retried by Inngest after a provider error → its failed call's tokens are counted once (the provider still bills them), the retry counted separately; both keyed by attempt
- [ ] Provider usage response missing cache fields → treat as 0 cached tokens and note it in the report
- [ ] Golden repo hits the GitHub rate limit during the run → that repo is marked `skipped: rate-limit`, never counted as a 0-cost ladder
- [ ] Parallel level generators finish in any order → spend summed atomically; the cap check uses the sum of finished + in-flight estimates
- [ ] Cap changed while a workflow runs → the run keeps the cap read at its start

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| `pricing.json` (config folder set by T003) | new: prices with source URL and date |
| cost module: `costOf(usage, model)`, `enforceCostCap` | new |
| generation workflow LLM steps (T006–T009) | call `enforceCostCap`; add cache-control provider options for model A |
| `pnpm cost:measure` script + `package.json` script entry | new |
| `docs/COST_REPORT.md` | new: measured numbers, decision |
| tests (vitest + Inngest test engine) | AC 1, 3, 5, 6 |
| `tasks/TASK_REVIEW_T017.md` | Evidence (reviewer) |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `.claude/**`, `agents/**`, `skills/**`, `templates/**`, `AGENTS.md`, `CLAUDE.md` | kit |
| `PRD.md`, `PROJECT_SPEC.md`, `PROJECT_KANBAN.md` | Supervisor-owned (the Supervisor closes Open Question 5 from the report) |
| `experiments/**` | pattern reference only |
| golden set content and scoring rules (T004) | the measurement must not tune its own yardstick |
| prompts and model choice (T006–T009) | out of scope; cost data first |
| `.env*` files with real keys | never commit secrets |

---

## Test Plan

Unit (vitest): cost arithmetic incl. cache-read and cache-write prices, missing price, cap boundary (equal / 1 cent over). Integration (vitest + Inngest test engine + mock models): cap stop with no partial ladder, cache hit at 0 cost, retried step counted once. Real run once by hand (`pnpm cost:measure`), report pasted into the review. Paste `pnpm test` output into the report.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run
- [ ] Security review: `Skill({ skill: "security-review" })` run (Medium risk)
- [ ] Lint passes (`pnpm lint`, `pnpm typecheck`)
- [ ] Tests written AND pass — output pasted into `tasks/TASK_REVIEW_T017.md` Evidence (Hard-Stop Gate 5)
- [ ] `Skill({ skill: "verify" })` run — headless auto verify
- [ ] Supervisor notified: task ready for Stage 4 review
