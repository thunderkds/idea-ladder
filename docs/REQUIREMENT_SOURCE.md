# Idea Ladder — Vision, Grill & Flow (requirement source)
> Snapshot of the Claude Docs requirement https://claude.ai/artifact/Gi5xG9avHmKfgymKANN3Cu (tab 77976cc8-6128, rev 28), taken 2026-11-01. Tables are flattened one cell per line. Source of truth stays the doc.


## Vision
Idea Ladder turns any idea you discover into a leveled path you can actually climb, and proves you climbed it. Paste a GitHub repo (or any URL), get a ladder from prerequisites to "rebuild it yourself", review daily in 5 minutes, and unlock each level only by passing its test.
- 
Verdict: worth building as a PWA, if the core value is persistence and proof, not content. AI chat already generates learning paths for free; what it can't do is track you for months, schedule reviews, and verify progress.
- 
Working name: Idea Ladder (placeholder).
- 
Relationship to Idea Radar: fully independent. Idea Radar discovers ideas; Idea Ladder teaches them. They connect only by a URL, like "Open in Gitpod" buttons.

## Problem and first user
First user: a developer who finds an interesting repo and wants to really learn it, not just star it. That is you, which makes research nearly free.
Today's pain
What Idea Ladder does
Starred repos are never revisited
A "Learn this" link turns a star into a ladder
Tutorials are passive; you forget within days
Daily recall and spaced review keep it
AI chat gives a path but forgets you exist
Progress, reviews and proof persist for months
No way to show what you actually learned
Each level passed leaves a proof (repo, PR, explanation)
Later users (only after the first works): developers learning adjacent fields, then any self-learner. Fields like languages or money are just content in the same engine.

## Vision flow
Idea Radar's only job is the link; everything after it happens inside Idea Ladder. A failed pass test loops back to study and review until the level is earned.

## Repo to ladder engine
Concepts are the reusable unit; the repo is only the entry point. Ten trending repos may all be "vector database" or "local LLM agent". Ladder per repo means thousands of duplicates; ladder per concept scales and lets the community improve one shared ladder.
- 
Read the repo from the GitHub API: README, topics, languages, dependency files, open issues, `good first issue labels. Pin to a commit SHA.
- 
Detect concepts: AI maps the repo to 3 to 6 concepts (e.g. "Rust async", "embeddings", "CRDT").
- 
Reuse or draft concept ladders: existing community ladders are reused; missing ones are AI-drafted and marked unverified.
- 
Generate the repo-specific top: L1 to L4 below, tied to this repo.
- 
Score confidence: thin README or no issues means low confidence; fall back to concept-only ladders.
Level
Goal
Pass test (proof)
Built from
L0 Prerequisites
Concepts you're missing
Concept ladder tests
Dependencies, languages, topics
L1 Run it
Clone, run, explain what it does
Screenshot or log + 3-sentence explanation
README, setup docs
L2 Modify
Change or add one small feature
Branch or diff link + questions generated from your diff
Code structure, issues
L3 Understand
Explain how the core works
Verified MCQs on core files; AI feedback on explanation (not a gate)
Core source files
L4 Rebuild or contribute
Minimal version from scratch, or a merged PR
Repo link or PR link
Core logic, good first issues
The L4 "rebuild it" step follows the build-your-own-X approach, which works because rebuilding forces you to understand the design decisions.

## LLM strategy
The LLM generates practice and questions; it never explains the repo and never decides a pass. Research shows repo explanation is already free elsewhere, question generation works when grounded and checked, and AI grading is too inconsistent to gate progress.
Task
Use LLM?
How
Evidence
Explain the repo
No
Link to README, official docs or DeepWiki
DeepWiki and PocketFlow already do this; accuracy drops on complex code
Map repo to concepts
Yes
Low stakes; learner can edit
Wrong mapping is cheap to fix
MCQs and review cards
Yes, verified
Grounded chunks, answer checked in source, dedupe, flag button
GPT-4 MCQs mostly good (651 vs 449 study); failures: wrong keys, trivial, repetitive
Questions on learner's own diff
Yes, core feature
Generated after L2 from the learner's changes
27% of passing students failed simple questions on their own code
Grade open answers
Feedback only
Never gates a level
Exact agreement 55% in one study; no agreement in another
Unlock levels, schedule reviews
No
Deterministic code and FSRS
Must be reproducible
Verification pipeline for every generated question:
- 
Generate only from retrieved chunks (README, docs, source files, learner diff).
- 
Code check: the answer key must appear in, or be checkable against, the cited chunk. A citation alone is not proof (generative search cites correctly about 74% of the time).
- 
Second model answers the question blind; a different answer from the key means discard. (Design choice, not yet tested.)
- 
Remove near-duplicates by embedding similarity.
- 
Learner flag: "this question seems wrong" (same pattern AutoMCQ uses). Frequently flagged cards are regenerated or removed.
Grading rules: use a different model than the generator (models rate their own output higher), cap answer length (judges favor verbose answers), and gate only on verified MCQs or GitHub-checked artifacts.

## LLM architecture: workflow, not agent team
Use a fixed workflow with one bounded agent as a tool, not a multi-agent system. Ladder generation follows known steps every time, which is where workflows beat agents; only choosing the core files is open-ended enough to need an agent loop.
Option
Fits Idea Ladder?
Why
Workflow (prompt chaining, parallelization, evaluator-optimizer)
Yes, the backbone
Steps are known in advance; predictable cost; each step testable and retryable
Single agent with tools
Only for the repo reader
Picking core files in an unknown repo is open-ended; bounded by a step cap and read-only tools
Agents as tools (manager keeps control)
Yes, how the reader is called
The workflow owns the final output and calls the reader like a function
Handoffs (specialist takes over)
No
Built for routing conversations; there is no conversation here
Multi-agent orchestrator-workers
No
Anthropic reports about 15x the tokens of chat; it pays off for breadth-heavy research, not a fixed pipeline
Parallel writer agents
No
Cognition found subagents that write in parallel make conflicting decisions without shared context
Parallel generators are safe here because each level is independent and grounded in its own chunks, the read-heavy case where parallelism works. The blind solver uses a different model than the generator, so it doesn't favor its own output.

## Framework stack
TypeScript end to end: Vercel AI SDK for model calls, Inngest for durable steps, Postgres with pgvector for everything stored. No agent framework is needed, because the system is a workflow with one small tool loop.
Layer
Pick
Why
Alternative
Model calls and structured output
Vercel AI SDK
Provider-agnostic, so each step can use a different model (cheap generator, different-provider checker); zod schemas for typed output
Mastra, if you want workflows, memory and evals bundled
Durable workflow
Inngest
Each step is checkpointed; a failed LLM step retries alone without re-paying earlier calls; runs on your existing deployment, no worker cluster
Trigger.dev; Temporal only at large scale
Repo reader (bounded agent)
AI SDK tool loop: 3 read-only tools, step cap, token budget
Needs only list, read and search; a full agent harness is overkill
Claude Agent SDK (subagents, file tools, structured output) if the reader grows
Grounding and dedupe
Postgres + pgvector
Chunks, embeddings, ladders, progress and evidence in one database
Dedicated vector DB only if scale demands
Cache
Ladders keyed by repo + commit SHA; provider prompt caching
First learner pays generation; everyone after reuses

Scheduler
FSRS library
Deterministic review intervals

Tracing and evals
Any LLM tracing tool + a golden set of about 20 hand-checked repos
Catch prompt regressions before learners do

Credentials
Open Badges 3.0 issuer (W3C Verifiable Credentials signing)
Portable, cryptographically verifiable proof
Plain signed JSON for v1, upgrade at v2
Rejected: LangGraph (Python-first state machines for complex cyclic agents; our only cycle is one bounded retry) and OpenAI Agents SDK handoffs (built for routing conversations between specialists; we have no conversation to route).

## Sequence: ladder generation
The API answers in milliseconds; generation runs in the background and notifies the PWA when done. Model A generates, model B (a different provider) checks, so the checker doesn't favor its own output.

## Sequence: pass test and proof
The LLM only writes questions from the learner's own diff. Ownership is checked against GitHub, scoring uses stored keys, and the credential is signed by the issuer, so no AI judgment decides a pass.

## Proof architecture
The LLM is never in the trust path: every proof is deterministic evidence plus a signature. Anyone can re-check a proof without trusting Idea Ladder's AI.
Layer
What it does
Built from
Identity binding
Learner signs in with GitHub OAuth; every artifact must belong to that GitHub account
GitHub OAuth
Verifiers (code only)
MCQ: score against verified keys. Artifact: repo or branch exists, author matches, commit SHA recorded, PR merged state. Diff questions: score above threshold
GitHub API, stored answer keys
Evidence record
One append-only record per level passed, with a SHA-256 hash of its contents
Postgres
Credential
On ladder completion, an Open Badges 3.0 credential (a W3C Verifiable Credential) signed with the issuer key, listing the evidence URLs
OB 3.0 / VC 2.0
Revocation
Status list entry per credential, so a credential can be revoked if cheating is found
VC status list
Public verify page
Checks the signature, then re-checks the GitHub evidence live
Profile URL
Evidence record (example):`
Anti-cheat: diff questions catch code the learner didn't write or understand (27% of passing students failed simple questions on their own code in one study); MCQs are drawn from a randomized pool; retakes are rate-limited; artifacts must match the signed-in GitHub account.

## Brainstorm: feature ideas
Build only what serves the core loop first; everything else waits for evidence. Sorted by when it belongs.
Idea
Why it matters
When
Ladder from any URL (repo, doc, article)
Removes cold start; any source becomes a path
MVP
5-minute daily review with FSRS
The daily habit; retention lives or dies here
MVP
Level unlock only after pass test
Stops skipping to level 3 with level 1 gaps
MVP
Offline PWA + push reminders
Review anywhere; reminders drive return visits
MVP
Proof-of-skill profile page
Shareable output; gives a reason to finish
v1
Concept ladders shared across repos
Dedupes content; community improves one ladder
v1
Community ladders in a Git repo, CI-validated
Growth engine, like roadmap.sh
v2
Author credit: "N learners passed your ladder"
Gives experts a reason to contribute
v2
Cohort mode (5 to 10 people, same ladder)
Social accountability lowers dropout
v3
"Learn what's trending" weekly pick
Fresh entry points; pairs with Idea Radar's brief
v3
Export ladder to Anki deck
Meets heavy Anki users where they are
Maybe
Paid verified certificates
Revenue; only if proof becomes trusted
Maybe

## Daily loop inside each level
Recall is the highlighted step because retrieval practice beats re-reading (Roediger and Karpicke, 2006); spaced review follows the spacing effect (Cepeda et al., 2006).

## Grill: hard questions
Three questions can kill the idea: AI chat substitutes, review habit, and fake proof. Each row has the current answer and how confident it is.
#
Hard question
Current answer
Confidence
1
Why not just ask ChatGPT or Claude for a path?
Don't compete on explanation (DeepWiki, PocketFlow already free); compete on practice, diff questions, review and proof
Medium
2
Will anyone come back daily?
Only if the 5-minute review feels good; test it before anything else
Low until tested
3
How do pass tests verify real skill?
Gate only on verified MCQs and GitHub-checked artifacts; AI grading is feedback only
Medium-high
4
Why not an Anki add-on?
Levels, unlocks, repo-awareness and proof don't fit Anki's card model
Medium
5
Why would experts contribute ladders?
Credit, profiles, learner counts; expect you to write ~90% at first
Low
6
Lowkey repos have thin READMEs; won't ladders be junk?
Confidence score + fall back to concept ladders
Medium
7
Repos change; won't L2 to L4 break?
Pin to commit SHA, regenerate on major release
High
8
AI cost per ladder?
Cache by repo + SHA; concept ladders reused across repos
High
9
Copyright on repo code and docs?
Link out; cards are original text only
High
10
Money or health ladders giving bad advice?
Concepts and mechanics only, required citations, stricter review
Medium
11
iOS clears PWA storage?
Push install early; sync to backend; export/import
High
12
Is this a product or a portfolio project?
Undecided; changes how much of v2 and v3 matters. Also: what if DeepWiki adds learning features? Diff questions and proof stay different
Open
Pivots if a kill question fails:
- 
Review habit fails → become a proof-of-skill portfolio tool (no daily loop).
- 
Proof fails → become a personal repo study tracker for Idea Radar users only.
- 
Both fail → ship ladders as an Anki deck export and stop.

## Architecture
Independence test: delete either app and the other still works. No shared database, login or API between them.
The only contract is `https://<ladder-app>/start?url=<repo or any URL>, the same pattern as "Open in Gitpod" or "Deploy to Vercel" buttons. Idea Ladder accepts URLs pasted by hand too.

## Roadmap
Only v0 and v1 have durations; later phases are dated once v1's gate passes. A failed gate triggers the pivots listed in the grill.

## First experiment and kill criteria
Validate with zero code in 2 weeks: hand-make 3 ladders and climb one.
- 
Pick 3 repos from Idea Radar: one trending, one medium, one lowkey
- 
Ask Claude to generate each ladder using the L0 to L4 template above
- 
Put the cards into Anki (FSRS on) as a stand-in for the app
- 
Climb one ladder for 14 days, 5 to 15 minutes a day
- 
Log each day: did review happen, did a level pass, what felt useless
Signal
Continue if
Kill or pivot if
Daily review
Done on 10 or more of 14 days without forcing
Skipped most days
Ladder quality
Trending and medium ladders usable with light edits
All three need rewriting
Lowkey repo
Concept fallback still gives a usable path
Useless even with fallback
Pass tests
At least one level felt genuinely earned
Tests felt like busywork
Pull
You want a "Learn this" button in Idea Radar
You forget the experiment exists

## Alternatives to investigate
Every current pick has a named alternative, a cheap test, and a trigger for switching. Most tests run on the golden set of about 20 hand-checked repos.
Area
Current pick
Alternative
How to test
Switch if
Repo understanding
Own bounded reader agent
DeepWiki (check whether it offers an API or MCP access), or fork PocketFlow's codebase-to-tutorial pipeline
Compare core-file picks and concept maps on the golden set
Alternative matches quality at lower cost or effort
Agent framework
Vercel AI SDK + Inngest
Mastra (workflows, memory, evals bundled); Claude Agent SDK (if the reader grows)
Build the reader step in each, about 1 day each
You hand-build 2+ of tracing, evals, memory
Durable execution
Inngest
Trigger.dev; Temporal
Kill a run mid-step and check resume and cost
Need self-hosting, or hundreds of workflows
Models
Model A generates, model B (other provider) checks
Single provider; small local model; bring-your-own key
Cost and accuracy per step on the golden set
Cost per ladder too high, or accuracy gap is small
Question checking
Blind solver (model B)
Entailment check against the cited chunk; human review only
Seed 100 questions with wrong keys and measure the catch rate
Another method catches more wrong keys per dollar
Open-answer grading
Feedback only, never gates
AI grade gates, with human audit of a sample
Grade 50 answers yourself, compare agreement
Agreement consistently close to human-to-human levels
Grounding store
Postgres + pgvector
Dedicated vector database
Query latency at real data size
pgvector becomes the bottleneck
Proof format
Open Badges 3.0 credential
Plain signed JSON; no credential at all
Ask 5 to 10 learners or hiring managers what they would trust
Nobody shares or checks proofs
Client
PWA
Native app
Track iOS install rate, push opt-in, storage loss
iOS limits hurt review retention
Review engine
Own FSRS scheduler
Export ladders to Anki
v0 experiment already uses Anki
Learners prefer staying in Anki
Content source
AI-generated ladders, community-verified
Curated-only ladders for a few popular repos
Compare completion rates
Generated ladders get flagged too often

## Open decisions
- 
Goal: portfolio and learning project, or a product meant to grow users?
- 
Core value (pick one): review habit, proof of skill, or community ladders?
- 
Name: keep "Idea Ladder" or choose another?
- 
Backend: local-first with optional sync, or accounts from day one?
- 
AI provider and cost cap per ladder
- 
Open source from v0, or only the ladder content repo at v2?

## Sources
- 
DeepWiki overview (Hugging Face)
- 
OpenWrt forum: DeepWiki may contain inaccuracies
- 
AI-generated documentation in legacy code analysis
- 
PocketFlow Tutorial-Codebase-Knowledge (SourcePulse)
- 
GPT-4 vs human MCQs in programming education (arXiv 2312.03173)
- 
LLM question quality across six CS courses (IATED 2026)
- 
ChatGPT vs educator MCQs in nursing education
- 
Questions about learners' own code detect fragile knowledge
- 
AutoMCQ: code comprehension questions with GenAI
- 
LLM-as-a-Grader (arXiv 2511.10819)
- 
ChatGPT grading short answers in mechanical ventilation
- 
Judging LLM-as-a-Judge (MT-Bench)
- 
CALM: 12 biases in LLM-as-a-Judge
- 
CiteFix: citation accuracy in RAG
- 
Anthropic: Building effective agents
- 
Anthropic: How we built our multi-agent research system
- 
Cognition: Don't Build Multi-Agents
- 
Cognition: Multi-Agents, What's Actually Working (2026)
- 
LangChain: How and when to build multi-agent systems
- 
OpenAI Agents SDK: agent orchestration
- 
TypeScript agent frameworks compared, 2026
- 
Inngest: durable workflows
- 
Claude Agent SDK: structured outputs
- 
1EdTech: Open Badges 3.0 release
- 
Certificates, badges and verifiable credentials
## Diagram text (extracted from embedded diagrams)

### Roadmap — "Each phase starts only when the previous gate passes"
- v0 Validate (now): No code, 2 weeks; 3 hand-made ladders; Anki as the app.
- Gate 1: Review on 10 of 14 days and ladders usable.
- v1 MVP PWA: About 4 to 6 weeks; URL to ladder, review; pass tests, offline, push.
- Gate 2: Others finish L1 without your help.
- v2 Proof, concepts: Public proof profile; shared concept ladders; "Learn this" in Radar.
- Gate 3: Proof links get shared; first outside ladder PR.
- v3 Community: Ladders repo + CI; author credit; cohort mode.

### Generation pipeline — "One workflow, one bounded agent, no agent team"
Every box is a durable Inngest step, retried on its own.
Fetch repo (code, no LLM) → Repo reader (agent as a tool, read-only) → Concept mapper (1 LLM call, structured)
→ Level generators x N (parallel, grounded chunks) → Code checks (gate: citation, dedupe; key mismatch: regenerate, max 2)
→ Blind solver (evaluator, other model; agrees →) → Save ladder (status: unverified).

### Evidence record example
{"learner":"github:thunderkds","ladder":"repo:owner/name@3f2a9c1","level":"L2","test":"artifact+diff-questions",
 "evidence":{"branch":"https://github.com/thunderkds/name/tree/add-retry","commit":"9b1e2d4",
 "diffQuestions":{"asked":5,"correct":4,"pass":4}},"verifiedBy":"verifier@1.3.0",
 "verifiedAt":"2026-11-01T09:12:00Z","hash":"sha256:..."}

### Vision flow — "Discover an idea, climb its ladder, leave with proof"
Idea Radar (finds a repo worth learning) → Learn this link (a plain URL, no shared data; or paste any URL) →
Idea Ladder reads repo (README, deps, issues, SHA) → Concepts detected (reuse or draft ladders) →
Ladder L0 to L4 (pinned to a commit SHA) → Daily 5-min review (FSRS spaced recall) ⇄ Pass test (unlocks the next level; not yet → study) → passed → Proof profile (repo, PR, explanation).

### Sequence: ladder generation — "A ladder is generated once per repo commit, then cached"
Participants: PWA (learner), Ladder API (HTTP), Workflow (Inngest), GitHub (REST API), Reader (bounded agent), LLMs (model A, B), Store (Postgres).
1 PWA→API POST /start · 2 API→Store look up ladder by repo + commit SHA · 3 Store→API hit: return cached ladder, stop here ·
4 API→Workflow miss: event · 5 API→PWA 202 + job id · 6 Workflow→GitHub tree, README, deps · 7 Workflow→Reader pick core files (agent as a tool) ·
8 Reader→GitHub list, read, search · 9 Reader→Workflow core files + reasons · 10 Workflow→LLMs map concepts (model A, schema) ·
11 Workflow→LLMs generate levels, N in parallel · 12 Workflow self: code checks: citation, dedupe · 13 Workflow→LLMs blind-solve each MCQ (model B) ·
14 Workflow→Store save ladder, status unverified · 15 Workflow→PWA push: ladder ready.

### Sequence: pass test and proof — "The LLM writes questions; only code decides the pass"
Participants: PWA (learner), Ladder API (verifiers), Workflow (Inngest), GitHub (REST API), LLMs (model A, B), Issuer (OB 3.0 signer), Store (Postgres).
1 PWA→API submit L2 branch · 2 API→GitHub branch exists? author = learner? · 3 GitHub→API diff + commit SHA · 4 API→Workflow event ·
5 Workflow→LLMs questions from the diff only (A) · 6 Workflow→LLMs blind-solve each question (B) · 7 Workflow self: keep only keys verified against the diff ·
8 Workflow→PWA push: 5 questions on your code · 9 PWA→API answers · 10 API self: score with stored keys (code, no LLM) ·
11 API→Store evidence record + SHA-256 hash · 12 API→PWA L3 unlocked (fail: back to review cards) · 13 API→Issuer after L4: issue credential ·
14 Issuer→Store VC + status · 15 Issuer→PWA signed badge + public verify URL.

### Daily loop — "Every level runs the same five-step loop"
Learn (20 to 30 min) → Recall (without notes; highlighted) → Use it (build or write) → Review (1, 3, 7, 21 days) → Explain (in plain words) → next small piece → Learn.

### Architecture — "Two apps, one URL between them, nothing shared"
Idea Radar (existing): Scraper + sources (GitHub, OSS Insight, more) → Repo DB (trending, medium, lowkey) → Dashboard + Wake brief (shows the Learn this link).
Idea Ladder (new PWA): PWA client (offline cache, push reminders, install prompt) → Ladder API (reads repo, detects concepts, caches by SHA) → Store (progress, proofs); Content repo (community ladders, CI) → Ladder API.
Link: Dashboard → PWA client, "URL only". GitHub API (public): each app calls it on its own, with its own token.
