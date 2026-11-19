# TASK_REVIEW — T007: Concept mapper (3–6 concepts, structured output) + learner edits concepts

> Sibling of `tasks/TASK_GUIDE_T007.md`. Everything here is **filled by the reviewer at Stage
> 4/5** — it is deliberately NOT in the guide, because the implementing agent re-reads the guide on
> every turn and never fills these two sections.
>
> Consumers resolve each section **guide first, this file second** (`.claude/hooks/lib/guide_sections.py`):
> a legacy guide that still carries these sections inline keeps working unchanged, and a stray
> review file can never override an inline section.

---

<!-- Optional: the final report, only for a task run in auto mode (the user's `[auto]` or `[admin]` tag; with `[admin]`, the `Not done:` line names `merge (admin: after the auto verify pass)`,
`docs/claude-md/tracks.md` `## Auto mode`). To use it, copy the block below out of this comment, to this
place, and replace every <...>. Keep `Mode: auto` as its first line, exactly as written: T182's hook reads
it. Write it to this file before the run ends; the chat message is a copy, not the report. The same
block is the Supervisor's final chat message. It is not the `delivery-report` page and not
Evidence. A taste decision (what the user wants) also ends with the flag. Write `DEBATED` only when ≥2
Advocate `Agent` calls ran for that question, naming each Advocate's option. A decision with no Advocates is
labelled `RULE`, `FACT` or `SAFER OPTION`, never `DEBATED`. A decision flagged `⚠ decided for you` is a choice, and is never labelled `FACT`. A
safety action a rule requires (for example the backup before a delete) is `RULE` without the flag.
At Risk Medium or High, a `RULE:` counts only when it names a written rule (`path:line`,
`path § <heading>`, or `docs/claude-md/tracks.md` `### <section>`), and a `FACT:` needs a Citation
(`path:line "quoted text"`); without one it is a choice and must be `DEBATED`. Good: `2. backed up the CSV
— RULE: `docs/claude-md/tracks.md` `### Stops that stay``. Bad: `1. kept recurring.csv — RULE: Surgical Changes`.
`Memory:` records the diff-driven memory pass you run before you stop: each entry written, or `nothing new`.
After an auto verify pass the hook, never you, adds `Closed: row moved to Done <date> — …` and moves the row,
or adds `Paused: done not moved — <reason>`. It moves the row only when this block holds `Mode: auto`, a
numbered decision, `Checks:`, `Memory:`, the `Not done:` auto verify slot with its result, and `Not done:`
naming the merge — no `<...>` left (`docs/claude-md/tracks.md` `### Auto close-out`).
With `/verify (yours)`, your pass goes in the `verify` row below: Result `☑ pass`, Notes `/verify by the user, session <id>, commit <sha>`.

## Auto decisions

Mode: auto
1. <what was decided> — RULE: <the rule>
2. <what was decided> — FACT: <path>:<line> "<quoted text>"
3. <what was decided> — DEBATED: <option> (Advocate 1: <its proposal>; Advocate 2: <its proposal>) ⚠ decided for you — please review
4. <what was decided> — SAFER OPTION: <why> ⚠ decided for you — please review
Paused: <only when a stop that stays paused the task: which one, and why>
Checks: tests `<command>` — <result>; reviews <skill — result>; real run `<command>` — printed `<what it printed>` (auto-checked, not /verify)
Memory: <each entry the memory pass wrote, as `file — entry` | nothing new>
Not done: merge (yours); <auto verify: running (T182) | auto verify: <result> | /verify (yours), with [admin] only after the one retry also ended blocked>

-->

## Auto decisions

Mode: auto
1. Requirement Fidelity Gate signed by the Supervisor before spawn (FR-002, FR-005, US-001 exist in PRD.md and every AC traces to them) — RULE: tasks/TASK_GUIDE_T007.md:54 "An agent must NOT start implementing until this gate is checked"
2. T007 guide aligned with T006 as built before spawn (migration 0007, `mapping`/`mapped`, `src/server/model-a.ts`, `usd: null` on claude-code) — RULE: CLAUDE.md:205 "No TASK_GUIDE = no work"
3. The golden-set run (AC 7) is run by the owner in their own terminal with `CLAUDE_CONFIG_DIR` set, as for T006; agents never run it — FACT: memory/learnings.md:28 "The owner's subscription login lives in `CLAUDE_CONFIG_DIR=/home/thunderkds/.claude-hung2`"
4. 2026-11-19: T007 rebuilt from this guide on a new `T007-concept-mapper` branch from main 467d538. The first build (review fixes 4f9c3c9, 3d72565, 4af71d0) was never pushed and its clone is not on this machine; the user chose "rebuild T007". The first build's review findings (reports/code-review_T007-concept-mapper_20261117T102941.html) went into the spawn prompts as known pitfalls — RULE: user instruction 2026-11-19 "rebuild T007"
5. The build was split across 7 sequential agents (A core, B API, B2 eval subject, C screen, two server fix agents, one client fix agent), each told to commit per item, because the 90-call step limit is counted per session and task, so the Supervisor's and every sub-agent's calls share one budget — FACT: .claude/hooks/pre_agent_step_limit.py:5-6 "counts tool calls per Task ID and blocks once a task exceeds CLAUDE_STEP_LIMIT (default 90)" and :16-17 "keyed on both the event's session_id and the task ID"
6. Added one `Edit concepts` link from the ladder view to `/ladders/:id/concepts`; the guide names the screen as the entry point but no way to reach it — SAFER OPTION: without it the screen is reachable only by typing the URL ⚠ decided for you — please review
7. Fixed all 3 P2 review findings (usage lost on a rejected answer, slug collisions C/C++/C# and non-Latin names, focus after Add/Remove) although `code-review` applies only P0/P1 by itself; the first build had accepted the C/C++/C# collision as P3 — SAFER OPTION: each is a small, test-first fix, and the usage one under-reports paid calls that T017 measures ⚠ decided for you — please review
8. 6 P3 findings go on the cut list (renamed row keeps its old reason until reload; a 401 on save loses unsaved edits; decodeURIComponent on a malformed id; Remove beside the input at 360 px instead of full-width; client max-length check before trim; two e2e tests share one seed) — RULE: .claude/skills/code-review/SKILL.md § Phase 4 "Do not apply P2/P3 fixes automatically"
9. Accepted the new token `--color-error: #b42318` in src/client/tokens.css (the error text needed one and none existed; 6.1:1 on --color-bg, WCAG AA) — SAFER OPTION: a token keeps check-tokens green; a literal would break lint ⚠ decided for you — please review
10. The 9 UI screenshots stay committed in e2e/artifacts/T007/ as the UI evidence (the folder is not git-ignored) — SAFER OPTION: the evidence rows below cite them by path ⚠ decided for you — please review
11. Two T015 offline e2e tests (e2e/pwa.e2e.ts:584, :743) are not a T007 regression: they fail the same way on clean main 4b520a3 (2 failed / 18 passed on both); a separate bugfix task is proposed — FACT: Supervisor run 2026-11-19 on a detached main checkout, `bun run test:e2e -- pwa` printed "2 failed" and "18 passed"
12. Process finding: 4 of 7 implementing agents did not read all Permanent-Rule startup files (one piped them to /dev/null and said so); mitigated by two independent reviewers checking the whole diff against the guide, not re-run — SAFER OPTION: a re-run would cost a full rebuild for no found defect ⚠ decided for you — please review
13. The eval command runs from eval/ (`cd eval && bun run eval -- --step concepts --subject concept-mapper`); no root `eval` script was added — RULE: AGENTS.md § Karpathy Engineering Principles "Surgical Changes"
Checks: tests `bun test` — 359 pass / 0 fail; `bun test concept-mapper learner-concepts` — 48 pass / 0 fail; `bun run test:e2e -- concepts-edit start-flow` — 17 passed; `bun run typecheck && bun run lint` — clean; reviews code-review — 0 P0, 1 P1 + 3 P2 fixed, 6 P3 on the cut list (reports/code-review_T007-concept-mapper_20261119T081600.html); migration-safety — GO; real run `cd eval && MODEL_A_BACKEND=api ANTHROPIC_API_KEY= MODEL_A_ID= bun run eval -- --step concepts --subject concept-mapper` — printed `eval failed: subject "concept-mapper" not found in src/subjects/: concept-mapper (MODEL_A_BACKEND=api) needs ANTHROPIC_API_KEY, MODEL_A_ID (paid run)` (auto-checked, not /verify)
Memory: memory/learnings.md — step limit shared per session and task; agents skip startup reads under step pressure; push a task branch before leaving a machine
Not done: golden-set run AC 7 (owner, paid); one live `/start` on `developit/mitt` (owner, real model call); auto verify: ☑ pass (session 7623ab38-86e3-4868-9160-f7cb19f19a9b, commit 8434607c013fbde20763592b4b3fd173ad876b4d, log .claude/verify-runs/T007-8434607c013f.log); merge (admin: after the auto verify pass)
Closed: row moved to Done 2026-11-19 — auto verify pass (session 7623ab38-86e3-4868-9160-f7cb19f19a9b, commit 8434607c013fbde20763592b4b3fd173ad876b4d); Gates 5 and 6 checked

## Evidence

| Check | Result | Notes / output snippet |
|-------|--------|------------------------|
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☑ pass | AC 1–2, SC 1–2: tests/concept-mapper.test.ts (both back ends); slug/name rules: tests/concept-mapper-shared.test.ts; AC 3 incl. failure paths: tests/concept-mapper-step.test.ts; AC 4–5 server, SC 3–4: tests/learner-concepts.test.ts; migration 0007: tests/migrate.test.ts; AC 7 subject: tests/concept-mapper-subject.test.ts; AC 5–6 screen, SC 5–6, focus, UI checks: e2e/concepts-edit.e2e.ts. `bun test concept-mapper learner-concepts` → 48 pass / 0 fail (2026-11-19T08:16:33Z) |
| Verification command run | ☑ pass | On 2218681 (2026-11-19T08:13:47Z): `bun run typecheck && bun run lint` → "Checked 100 files in 57ms. No fixes applied." / "check-tokens: 0 color literals outside src/client/tokens.css"; `bun test concept-mapper learner-concepts` → 48 pass / 0 fail; `bun run test:e2e -- concepts-edit` (with start-flow) → 17 passed. `bun run eval -- --step concepts --subject concept-mapper` NOT run: paid / subscription run, owner's (Auto decision 3) |
| Negative cases hold | ☑ pass | Red before green: map-concepts step test 0 pass / 5 fail before the step existed (agent A); usage on rejected answer "Expected length: 2 / Received length: 0" before 5cd665f; slug collisions 1 fail before 2218681; focus "toBeFocused() failed — Received: inactive" before a5f47be. 422 cases (2/7 concepts, empty, > 60 code points, duplicate slug, NUL/DEL) asserted in tests/learner-concepts.test.ts and on screen in e2e/concepts-edit.e2e.ts. Failure-path tests (4bcc80d) passed at once: the code was already correct |
| verify | ☑ pass | auto-run by hook, session 7623ab38-86e3-4868-9160-f7cb19f19a9b, commit 8434607c013fbde20763592b4b3fd173ad876b4d, log .claude/verify-runs/T007-8434607c013f.log — pass |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | ☑ pass | Reviewed: `git diff main...HEAD` (43 files) plus direct callers — server half (migrations, src/server, src/shared, eval, tests) and client half (src/client, e2e) by two independent reviewers. Skipped: kit files and modules the diff does not call |
| Full smoke suite still green (no regression) | ☑ pass | `bun test` → 359 pass / 0 fail (baseline 310). Full e2e (agent C): 57 passed, 1 failed; `-- pwa`: 2 failed / 18 passed — the same 2 T015 tests fail identically on clean main 4b520a3, so not a T007 regression (Auto decision 11) |
| **Companion score (easy-verifier)** | ☑ N/A | Neither companion tool was run for this task |
| **UI: Visual regression (diff or verdict pasted)** | ☑ pass | e2e/artifacts/T007/concepts-{4,error,banner}-{mobile,tablet,desktop}.png, each read and judged by agent C and two read by the client reviewer: 4-concept list shows name input, reason, Remove; error "need 3 to 6 concepts, got 7" with all 7 inputs kept; banner `Low confidence: this ladder uses concepts only` above the list |
| **UI: Design-system compliance (tokens/colors/typography verified)** | ☑ pass | Playwright computed-style assertions in e2e/concepts-edit.e2e.ts compare body, h1, labels, inputs, reason text, buttons, error text and banner colours, font sizes, weights, gaps and padding with the resolved token values; `check-tokens: 0 color literals outside src/client/tokens.css`; new token --color-error (Auto decision 9) |
| **UI: Responsiveness at target viewports** | ☑ pass | 360×740, 768×1024, 1280×800: `scrollWidth <= viewport` for all three states; every button, link and input ≥ 44 px tall; `Save concepts` inside the viewport at all three sizes with 4 concepts and at 360×740 with 7 (sticky bar). Open P3: Remove sits beside the input at 360 px (Auto decision 8) |

---

## Demonstration

> Anchors what this task delivered to an observable before/after pair. BEFORE has no `N/A` path:
> if the task changes executable code, BEFORE is a pasted, timestamped terminal capture taken
> **before any implementation commit exists**; if it does not (docs, templates, skill-instruction
> text), BEFORE is the **verbatim prior content** of what changed — a quoted excerpt, not a command.

**BEFORE** (command: `date -u +%Y-%m-%dT%H:%M:%SZ; bun test concept-mapper learner-concepts; ls migrations | grep 0007 || echo "no 0007 migration"`):

```
2026-11-19T07:36:43Z
bun test v1.4.4 (38afee6c8)
The following filters did not match any test files in --cwd="/home/thunderkds/workspace/pets/hungnguyen111/wt-t007":
 concept-mapper learner-concepts
39 files were searched [2.00ms]

note: Tests need ".test", "_test_", ".spec" or "_spec_" in the filename (ex: "MyApp.test.ts")

no 0007 migration
```

**AFTER** (same command, on 2218681):

```
2026-11-19T08:16:33Z

 48 pass
 0 fail
 209 expect() calls
Ran 48 tests across 5 files. [2.96s]
0007_concepts.down.sql
0007_concepts.up.sql
```

**DELTA**: A finished repo job now maps the repo to 3–6 grounded concepts (`map-concepts`, job status `mapped`), and a signed-in learner can rename, remove and add their own concepts on `/ladders/:id/concepts` without changing the shared list.

**WITNESS**: Supervisor session 98505c1f-ee35-4589-bb57-774f30f8b789 ran the AFTER command at 2026-11-19T08:16:33Z (trace: memory/event-trace/T007.jsonl); BEFORE by agent A at 2026-11-19T07:36:43Z, commit 1353c56.
