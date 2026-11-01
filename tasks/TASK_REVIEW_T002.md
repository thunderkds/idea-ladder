# TASK_REVIEW — T002: v0 experiment kit — 3 ladders, Anki import file, 14-day log

> Sibling of `tasks/TASK_GUIDE_T002.md`. Everything here is **filled by the reviewer at Stage
> 4/5** — it is deliberately NOT in the guide, because the implementing agent re-reads the guide on
> every turn and never fills these two sections.
>
> Consumers resolve each section **guide first, this file second** (`.claude/hooks/lib/guide_sections.py`):
> a legacy guide that still carries these sections inline keeps working unchanged, and a stray
> review file can never override an inline section.

---

## Auto decisions

Mode: auto
1. Repos for the v0 ladders: trending `The-Pocket/PocketFlow`, medium `developit/mitt`, lowkey `lukeed/dset` — SAFER OPTION: the source says "Pick 3 repos from Idea Radar" and Idea Radar is not in this repo; picked by GitHub API stars/activity, one per class ⚠ decided for you — please review · Confirmed by user 2026-11-01: "keep the current repos"
2. Recommended ladder to climb: `developit/mitt` — SAFER OPTION: smallest core, so L4 rebuild fits inside 14 days ⚠ decided for you — please review
3. Anki plain-text import (`.txt`) instead of `.apkg` — RULE: guide cut list (no dependency); Anki imports it with FSRS on
4. Agent fixed the verification path (`test/index.js` + `package.json` type module) because `node --test <dir>/` fails on Node v26.7.0 — FACT: agent report, re-run by Supervisor passes
5. Added `"test": "node --test test/"` to `experiments/v0-kit/package.json` (agent, commit dbbddbb) so the trace hook recognises the run (it counts `npm test`, not `node --test`) — RULE: `docs/claude-md/tracks.md` `### Auto-mode check (Stop hook)` (check 7: the task's trace must hold a test run)
Checks: tests `npm test` (in experiments/v0-kit) — 12/12 pass; reviews code-review — 0 P0, 0 P1, 0 P2 for T002; real run `node experiments/v0-kit/build-anki.mjs` — printed `mitt: 26 cards (L0=5 L1=5 L2=5 L3=6 L4=5)` and 2 more lines (auto-checked, not /verify)
Memory: memory/decisions.md — "v0 runs as experiments only"; memory/MEMORY.md — 2 index lines
Not done: merge (yours); auto verify: ☑ pass (session cfd34d50-d813-4517-8ce1-6a3b7fca5031, commit de5cb7a299a45e94293f1281da6317ab9c0ce244, log .claude/verify-runs/T002-de5cb7a299a4.log); the 14-day climb itself (yours); readiness incomplete: Approved by (yours)
Closed: row moved to Done 2026-11-01 — auto verify pass (session cfd34d50-d813-4517-8ce1-6a3b7fca5031, commit de5cb7a299a45e94293f1281da6317ab9c0ce244); Gates 5 and 6 checked

## Evidence

| Check | Result | Notes / output snippet |
|-------|--------|------------------------|
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☑ pass | `experiments/v0-kit/test/index.js` — 12 new tests (AC 1–5: 3 real ladders, SHA + headers, tab/missing L3/2-card/long Back/fenced code/quote/missing header/missing Goal/README copy). Supervisor re-run 2026-11-01: `ℹ tests 12 ℹ pass 12 ℹ fail 0` |
| Verification command run | ☑ pass | `node --test experiments/v0-kit/test/ && node experiments/v0-kit/build-anki.mjs && head -5 experiments/v0-kit/anki/*.txt` → `dset: 26 cards` / `mitt: 26 cards` / `pocketflow: 27 cards`; headers `#separator:tab` `#html:false` `#tags column:3` — pass |
| Negative cases hold | ☑ pass | tab in Back, missing L3, level with 2 cards → exit 1 naming file + card (tests 4–6) — pass |
| verify | ☑ pass | auto-run by hook, session cfd34d50-d813-4517-8ce1-6a3b7fca5031, commit de5cb7a299a45e94293f1281da6317ab9c0ce244, log .claude/verify-runs/T002-de5cb7a299a4.log — pass |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | ☑ pass | code-review on `plan/idea-ladder-init..T002-v0-kit` only (11 files, experiments/v0-kit/**); lane_check: `EXCEEDS (files 11 > 6; lines 739 > 250)` — content files (3 ladders + 3 generated .txt) inflate it; no relabel |
| Full smoke suite still green (no regression) | ☑ pass | no prior code; only suite is the new one — 12/12 pass |
| **Companion score (easy-verifier)** | ☑ N/A | not run: optional companion tool; spike/content task |
| **UI: Visual regression (diff or verdict pasted)** | ☑ N/A | no UI component |
| **UI: Design-system compliance (tokens/colors/typography verified)** | ☑ N/A | no UI component |
| **UI: Responsiveness at target viewports** | ☑ N/A | no UI component |

---

## Demonstration

> Anchors what this task delivered to an observable before/after pair. BEFORE has no `N/A` path:
> if the task changes executable code, BEFORE is a pasted, timestamped terminal capture taken
> **before any implementation commit exists**; if it does not (docs, templates, skill-instruction
> text), BEFORE is the **verbatim prior content** of what changed — a quoted excerpt, not a command.

**BEFORE**: `2026-11-01T09:07:22+07:00 $ ls experiments/v0-kit/anki → ls: cannot access 'experiments/v0-kit/anki': No such file or directory`

**AFTER**: `2026-11-01T09:12:47+07:00 $ ls experiments/v0-kit/anki` → `dset.txt  mitt.txt  pocketflow.txt`; `$ node experiments/v0-kit/build-anki.mjs` → `dset: 26 cards (L0=5 L1=5 L2=5 L3=6 L4=5)` / `mitt: 26 cards (L0=5 L1=5 L2=5 L3=6 L4=5)` / `pocketflow: 27 cards (L0=5 L1=5 L2=5 L3=7 L4=5)`; `$ node --test experiments/v0-kit/test/` → `ℹ tests 12 / ℹ pass 12 / ℹ fail 0`

**DELTA**: The owner can import three ready ladders (79 cards) into Anki, turn FSRS on, and start the 14-day log today.

**WITNESS**: Supervisor (main session) re-ran the verification command at 2026-11-01T09:17Z with the active-task state set to T002 (trace `memory/event-trace/T002.jsonl`); implementing agent ran it first at 09:12+07:00.
