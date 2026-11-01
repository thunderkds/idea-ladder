# Main flow — Idea Ladder

Source: `docs/REQUIREMENT_SOURCE.md` § Vision flow, § Diagram text (generation pipeline), § Sequence: pass test and proof.

```mermaid
flowchart TD
  U[Learner pastes URL or opens /start?url=] --> F[Fetch repo: GitHub API, pin commit SHA — code, no LLM]
  F --> C{Cached ladder for repo+SHA?}
  C -- yes --> L[Ladder L0–L4]
  C -- no --> R[Repo reader: bounded read-only agent]
  R --> M[Concept mapper: 3–6 concepts]
  M --> G[Level generators x N, grounded chunks]
  G --> K{Code checks: key in cited chunk, dedupe}
  K -- mismatch, max 2 --> G
  K -- pass --> B{Blind solver, other model, agrees?}
  B -- no --> G
  B -- yes --> S[Save ladder: unverified] --> L
  L --> D[Daily loop: study → recall → FSRS review]
  D --> T{Pass test: verified MCQs / GitHub-checked artifact / diff questions 4 of 5}
  T -- fail --> D
  T -- pass --> E[Evidence record: append-only, SHA-256] --> N[Next level unlocks]
  N --> D
  E --> V[Ladder complete → signed credential → public verify page re-checks GitHub]
```

v0 replaces everything above the "Ladder" node with hand-made ladders (`claude` CLI) and replaces the
daily loop with Anki (FSRS on). T001 measures the nodes "Code checks" and "Evidence record".
