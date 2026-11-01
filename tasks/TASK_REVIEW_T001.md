# TASK_REVIEW — T001: Spike — measure the deterministic core (answer-key check, signed proof, GitHub read)

> Sibling of `tasks/TASK_GUIDE_T001.md`. Everything here is **filled by the reviewer at Stage
> 4/5** — it is deliberately NOT in the guide, because the implementing agent re-reads the guide on
> every turn and never fills these two sections.
>
> Consumers resolve each section **guide first, this file second** (`.claude/hooks/lib/guide_sections.py`):
> a legacy guide that still carries these sections inline keeps working unchanged, and a stray
> review file can never override an inline section.

---

## Auto decisions

Mode: auto
1. v0 direction = Option B narrowed: v0 ladder kit (T002) + this LLM-free spike; FSRS spike cut, blind solver out of scope — DEBATED: Option B narrowed (Advocate 1: Option B — v0 kit plus deterministic spike with pre-registered thresholds; Advocate 2: Option A — no code, at most the answer-key check, cut FSRS) ⚠ decided for you — please review
2. Idea Ladder board = local mode: `.claude/board.json` → `.claude/board.linear.json.bak`; other project's cache + 149 HUN guides → `docs/archive/easy-personal-board/` (git-ignored); no Linear writes — DEBATED: local mode + archive (Advocate 1: local mode, archive the HUN guides and old KANBAN; Advocate 2: local mode by moving board.json, back up the cache in the repo) ⚠ decided for you — please review
3. Thresholds fixed before the first run and not tuned after — RULE: `tasks/TASK_GUIDE_T001.md` § Pre-registered thresholds
4. Spawned on this session's CLI and model (claude, Opus 5.5) — RULE: `docs/claude-md/tracks.md` `### Every user stop and its auto rule` (row 14: empty CLI Model Table cell)
5. Skipped `fewer-permission-prompts` and `update-config` — RULE: `docs/claude-md/tracks.md` `### Every user stop and its auto rule` (row 5)
6. PRD Open Questions 1–6 left open, not guessed — RULE: `docs/claude-md/phase0-project-initiation.md` § Step 1.5 (materiality heuristic: v0 builds do not differ)
7. Added a temporary local `refs/remotes/origin/HEAD` → plan branch so the built-in `security-review` could diff (repo has no remote); deleted right after — RULE: `docs/claude-md/tracks.md` `### Final report` (security-review must run at Risk Medium)
Checks: tests `pnpm test` — 47/47 pass; reviews code-review — 0 P0, 0 P1, 3 P2 (borderline FAIL: 6/53 false rejects vs ≤5.3 allowed, seed written by the implementer — re-measure on an independent seed before v1; confidence rule scores `lukeed/dset` high while T002 judged it thin — revisit the rule; no red test phase was run before implementation), 1 P3 (`/languages` not pinned to the SHA); security-review — no findings; real run `pnpm experiment` — printed `VERDICT answer-key code check: FAIL (catch 96.9% vs >= 90%; false-reject 11.3% vs <= 10%)`, `VERDICT signed proof: KEEP`, `VERDICT GitHub read: KEEP` (auto-checked, not /verify)
Memory: memory/decisions.md — "v0 runs as experiments only (Option B, narrowed)", "Idea Ladder uses board mode local"; memory/MEMORY.md — 2 index lines
Not done: merge (yours); auto verify: running (T182); html-report pages for code-review/security-review (not generated); settings-setup dry run (not run; default High security recommended); readiness incomplete: Approved by (yours)

## Evidence

| Check | Result | Notes / output snippet |
|-------|--------|------------------------|
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☑ pass | `experiments/core-spike/test/{keycheck,measure,proof,github,confidence,fixtures,seed,report}.test.ts` — 47 new tests (AC 1–9). Supervisor re-run 2026-11-01T09:17: `Test Files 8 passed (8)` / `Tests 47 passed (47)` |
| Verification command run | ☑ pass | `cd experiments/core-spike && pnpm install --frozen-lockfile && pnpm test && pnpm experiment && cat RESULTS.md` → 47/47 pass; 3 VERDICT lines (code check FAIL by threshold, signed proof KEEP, GitHub read KEEP) — pass (the command ran; a FAIL verdict is a valid experimental result, per guide) |
| Negative cases hold | ☑ pass | `map`/`bitmap`, `60`/`60,000` → pass:false; 17/17 tamper cases rejected; 403+remaining 0 → RateLimitError; 404 → RepoNotFoundError; tests offline (replay fetch throws on unknown URL) — pass |
| verify | ☐ pass / ☐ fail / ☐ N/A | [what was observed — must literally state "pass" or "fail" here too, e.g. "skill run, feature confirmed working — pass": the merge gate scans this Notes column for the word "pass", not just the Result column] |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | ☑ pass | code-review + security-review on `plan/idea-ladder-init..T001-core-spike` only (experiments/core-spike/**); lane_check `EXCEEDS (files 25 > 14; lines 2151 > 500)` — fixtures, lockfile and seed JSON inflate it; src is 442 lines; no relabel |
| Full smoke suite still green (no regression) | ☑ pass | no prior code; only suite is the new one — 47/47 pass; `pnpm typecheck` clean (agent) |
| **Companion score (easy-verifier)** | ☑ N/A | not run: optional companion tool; throwaway spike |
| **UI: Visual regression (diff or verdict pasted)** | ☑ N/A | no UI component |
| **UI: Design-system compliance (tokens/colors/typography verified)** | ☑ N/A | no UI component |
| **UI: Responsiveness at target viewports** | ☑ N/A | no UI component |

---

## Demonstration

> Anchors what this task delivered to an observable before/after pair. BEFORE has no `N/A` path:
> if the task changes executable code, BEFORE is a pasted, timestamped terminal capture taken
> **before any implementation commit exists**; if it does not (docs, templates, skill-instruction
> text), BEFORE is the **verbatim prior content** of what changed — a quoted excerpt, not a command.

**BEFORE**: `2026-11-01T09:07:22+07:00 $ ls experiments/core-spike/RESULTS.md → ls: cannot access 'experiments/core-spike/RESULTS.md': No such file or directory`

**AFTER**: `2026-11-01T09:16:50+07:00 $ cd experiments/core-spike && pnpm experiment` →
```
VERDICT answer-key code check: FAIL (catch 96.9% vs >= 90%; false-reject 11.3% vs <= 10%). Code check alone is insufficient: blind solver or entailment check required
VERDICT signed proof: KEEP (untouched record verifies; 17/17 tamper cases rejected = 100%)
VERDICT GitHub read: KEEP (all 3 repos gave a 40-hex SHA + snapshot in <= 20 API calls each)
wrote RESULTS.md
```
(`experiments/core-spike/RESULTS.md` now exists; `pnpm test`: 8 files, 47 tests passed.)

**DELTA**: A user can run one offline command and read measured numbers (catch rate, false-reject rate, tamper rejection, SHA pin + confidence per repo) with a pre-registered verdict for each v1 bet, instead of assuming them.

**WITNESS**: Supervisor (main session) re-ran `pnpm install --frozen-lockfile && pnpm test && pnpm experiment` at 2026-11-01T09:17+07:00 with the active-task state set to T001 (trace `memory/event-trace/T001.jsonl`): same 3 verdicts; implementing agent ran it first at 09:16:50+07:00.
