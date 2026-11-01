# Main flow — Idea Ladder

Source: all 7 diagrams of the requirement doc (read 2026-11-01), as text in `docs/REQUIREMENT_SOURCE.md` § Diagram text.

## 1. Components — "Two apps, one URL between them, nothing shared"

```mermaid
flowchart LR
  subgraph Radar[Idea Radar — existing]
    SC[Scraper + sources: GitHub, OSS Insight] --> DB[Repo DB: trending, medium, lowkey] --> DA[Dashboard + Wake brief: shows Learn this link]
  end
  subgraph Ladder[Idea Ladder — new PWA]
    PWA[PWA client: offline cache, push, install prompt] --> API[Ladder API: reads repo, detects concepts, caches by SHA]
    API --> ST[Store: progress, proofs]
    CR[Content repo: community ladders, CI] --> API
  end
  DA -- URL only --> PWA
  Radar -. own token .-> GH[(GitHub API, public)]
  Ladder -. own token .-> GH
```

## 2. Ladder generation — "generated once per repo commit, then cached"

```mermaid
sequenceDiagram
  participant P as PWA
  participant A as Ladder API
  participant F as Workflow (Inngest)
  participant G as GitHub
  participant R as Reader (bounded agent)
  participant L as LLMs (A, B)
  participant S as Store (Postgres)
  P->>A: POST /start
  A->>S: look up ladder by repo + commit SHA
  S-->>A: hit → return cached ladder, stop
  A->>F: miss → event
  A-->>P: 202 + job id
  F->>G: tree, README, deps
  F->>R: pick core files (agent as a tool)
  R->>G: list, read, search
  R-->>F: core files + reasons
  F->>L: map concepts (model A, schema)
  F->>L: generate levels, N in parallel
  F->>F: code checks: citation, dedupe (key mismatch → regenerate, max 2)
  F->>L: blind-solve each MCQ (model B)
  F->>S: save ladder, status unverified
  F-->>P: push: ladder ready
```

## 3. Learner loop — vision flow + daily loop

```mermaid
flowchart TD
  L[Ladder L0–L4, pinned to SHA] --> D[Daily loop per level: Learn 20–30 min → Recall without notes → Use it → Review → Explain in plain words → next small piece]
  D --> T{Pass test}
  T -- not yet --> D
  T -- passed --> PR[Proof profile: repo, PR, explanation]
  PR --> N[Next level unlocks] --> D
```

## 4. Pass test and proof — "The LLM writes questions; only code decides the pass"

```mermaid
sequenceDiagram
  participant P as PWA
  participant A as Ladder API (verifiers)
  participant F as Workflow
  participant G as GitHub
  participant L as LLMs (A, B)
  participant I as Issuer
  participant S as Store
  P->>A: submit L2 branch
  A->>G: branch exists? author = learner?
  G-->>A: diff + commit SHA
  A->>F: event
  F->>L: questions from the diff only (A)
  F->>L: blind-solve each question (B)
  F->>F: keep only keys verified against the diff
  F-->>P: push: 5 questions on your code
  P->>A: answers
  A->>A: score with stored keys (code, no LLM)
  A->>S: evidence record + SHA-256 hash
  A-->>P: L3 unlocked (fail: back to review cards)
  A->>I: after L4: issue credential
  I->>S: VC + status
  I-->>P: signed badge + public verify URL
```

## 5. Conflicts inside the source (to settle before v1)

| # | Conflict | Where | Suggested reading |
|---|---|---|---|
| C1 | Daily loop says "Review 1, 3, 7, 21 days" (fixed intervals); the stack says FSRS (adaptive intervals, "Deterministic review intervals") | daily-loop diagram vs § Framework stack | FSRS wins; the fixed days are an illustration |
| C2 | Pass-test diagram names the Issuer an "OB 3.0 signer" issuing a VC; the stack says "Plain signed JSON for v1, upgrade at v2" | pass-test diagram vs § Framework stack | v1 = plain signed JSON (T001 tested this); OB 3.0 at v2 |
| C4 | Gate 3 (before v3) needs a "first outside ladder PR", but the community ladders repo that receives such a PR is built in v3 (T025) | roadmap diagram | T025 may start once Gate 3's "proof links get shared" part passes; the outside-PR part is then checked after T025 |
| C3 | Vision says "review daily in 5 minutes"; the daily loop starts with "Learn 20 to 30 min" | § Vision vs daily-loop diagram | 5 min = review only; a level's learn step is longer |

## 6. Facts from the diagrams that change earlier assumptions

- **Idea Radar exists** ("Idea Radar (existing)") and its Repo DB already sorts repos into trending, medium, lowkey. The v0 repos were picked by the Supervisor because Radar is not in this repo; picking them from Radar's DB is closer to the requirement.
- The **diff questions are blind-solved by model B too**. T001's result (code check alone false-rejects 11.3%) applies to both MCQs and diff questions.
- Each app calls the GitHub API **with its own token** — v1 needs a token (T001 used the unauthenticated limit of 60/h).
