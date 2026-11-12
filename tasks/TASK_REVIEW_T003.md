# TASK_REVIEW — T003: Scaffold — TypeScript app, Postgres + pgvector, migrations, GitHub OAuth sign-in, CI

> Sibling of `tasks/TASK_GUIDE_T003.md`. Everything here is **filled by the reviewer at Stage
> 4/5** — it is deliberately NOT in the guide, because the implementing agent re-reads the guide on
> every turn and never fills these two sections.
>
> Consumers resolve each section **guide first, this file second** (`.claude/hooks/lib/guide_sections.py`):
> a legacy guide that still carries these sections inline keeps working unchanged, and a stray
> review file can never override an inline section.

---

<!-- Optional: the final report, only for a task run in auto mode (the user's `[auto]` tag,
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

## Auto decisions

Mode: auto
1. <what was decided> — RULE: <the rule>
2. <what was decided> — FACT: <path>:<line> "<quoted text>"
3. <what was decided> — DEBATED: <option> (Advocate 1: <its proposal>; Advocate 2: <its proposal>) ⚠ decided for you — please review
4. <what was decided> — SAFER OPTION: <why> ⚠ decided for you — please review
Paused: <only when a stop that stays paused the task: which one, and why>
Checks: tests `<command>` — <result>; reviews <skill — result>; real run `<command>` — printed `<what it printed>` (auto-checked, not /verify)
Memory: <each entry the memory pass wrote, as `file — entry` | nothing new>
Not done: merge (yours); <auto verify: running (T182) | auto verify: <result> | /verify (yours)>

-->

## Evidence

| Check | Result | Notes / output snippet |
|-------|--------|------------------------|
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☑ pass / ☐ fail | Written in this task (implementing agent, commit `8987ac6`; reviewer to confirm). `tests/migrate.test.ts` (AC 1: vector + users/sessions columns, github_id unique, down → empty schema with rows present, up again, atomic failure, missing-extension message); `tests/auth.test.ts` (AC 2 authorize URL/scope/state; AC 3 upsert + cookie flags + /ladders; AC 4 mismatched/missing state, missing/tampered/expired state cookie, failed token exchange, `error=access_denied`, replay; AC 5 rename + two accounts; AC 6 guard, forged/expired session, sign-out; security headers); `tests/config.test.ts` (missing env vars named); `e2e/sign-in.e2e.ts` (AC 3 tracer, AC 6 sign-out replay, UI rows). Run 2026-11-12T08:29:33Z, HEAD `8987ac6`: `bun test` → ` 34 pass` ` 0 fail` ` 119 expect() calls` `Ran 34 tests across 3 files. [466.00ms]`; `bun run test:e2e -- sign-in` → `✓ 1 … sign-in tracer: GitHub sign-in lands on an empty My ladders page (726ms)` `✓ 2 … sign-out: the old session no longer opens My ladders (469ms)` `✓ 3 … signed out, /ladders redirects to / (148ms)` `3 passed`. Test-first: the suite was red (`Cannot find module '../src/server/config.ts'`, 0 pass 3 fail) before the source existed; the security-header test was red (`20 pass 1 fail`) before `secureHeaders()` was added. |
| Verification command run | ☑ pass / ☐ fail | Guide's Verification Command, 2026-11-12T08:29:33Z, HEAD `8987ac6`, every step `exit=0`: `docker compose up -d db` → `Container wt-t003-db-1 Running`; `bun install --frozen-lockfile` → `Checked 38 installs across 94 packages (no changes)`; migrate up/down/up → `applied: 0001_init` / `reverted: 0001_init` / `applied: 0001_init`; `bun run typecheck && bun run lint && bun test` → `tsc --noEmit` (no output), `Checked 28 files in 15ms. No fixes applied.`, `check-tokens: 0 color literals outside src/client/tokens.css`, `34 pass 0 fail`; e2e `3 passed`. `bun run ci:local` 2026-11-12T08:32:34Z → all 8 steps ran, last line `ci:local: all steps passed`, `exit=0`. |
| Negative cases hold | ☑ pass / ☐ fail | `tests/auth.test.ts` "callback negatives (AC 4)": each case asserts `400`, body `Sign-in failed`, no `il_session` cookie, `users` count 0, `sessions` count 0 — mismatched state, missing state, missing state cookie, tampered cookie, expired cookie (601 s), never-issued code, `error=access_denied`; replay → second call 400 and `sessions` count stays 1. Forged and expired session cookies → `/ladders` 302. Missing env at start: `Invalid configuration: missing required environment variable(s): DATABASE_URL, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, SESSION_SECRET` exit=1. All pass in the 34-test run above. |
| verify | ☐ pass / ☐ fail / ☐ N/A | [what was observed — must literally state "pass" or "fail" here too, e.g. "skill run, feature confirmed working — pass": the merge gate scans this Notes column for the word "pass", not just the Result column] |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | ☐ pass / ☐ fail | [what was reviewed vs. skipped, and why] |
| Full smoke suite still green (no regression) | ☑ pass / ☐ fail | First app code in the repo, so no prior app suite exists. `bun run ci:local` (whole app suite: typecheck, lint, 34 unit tests, migrations up/down/up, 3 e2e) → `ci:local: all steps passed`. `bunfig.toml` sets `[test] root = "tests"`, so `bun test` does not pick up the vitest suites under `experiments/`; those were not touched. |
| **Companion score (easy-verifier)** | ☐ pass / ☐ fail / ☐ N/A | [`overall` and `change_risk` as the tool returned them, the scope, the ref, and the absolute path of the verifier report after a literal `report:` label — e.g. "overall 86 (>= 80), change_risk pass, scope changes, ref `main...HEAD`, report: `/home/me/.easy-verifier-reports/kit/score_changes_20261028T0530Z.html`". The gate reads the path that follows `report:` and nothing else, so with no label, or a path that is absent, the row is unscored — write ☑ N/A instead. ☑ N/A with a reason when neither companion tool was run: the merge gate blocks on ☑ fail only, never on an absent or N/A row] |
| **UI: Visual regression (diff or verdict pasted)** | ☑ pass / ☐ fail / ☐ N/A | Screenshots from `e2e/sign-in.e2e.ts`, baseline committed in `e2e/baseline/{home,ladders}-{mobile,tablet,desktop}.png`. LLM-vision verdict (implementing agent, Claude Opus 5.5, read all 6 images; reviewer to confirm): `/` — heading "Idea Ladder", one tagline, one blue `Sign in with GitHub` button, no overflow; full-width button at 360 px, left-aligned in a centered column at 768/1280. `/ladders` — bar with "Idea Ladder", `@octo` and a `Sign out` button; heading `My ladders`; dashed empty card `No ladders yet`; no overflow at any width. Matches AC 2 and AC 3. Pixel-diff gate not added (cut list in `docs/decisions/0001-web-framework.md`: fonts differ between WSL and CI). |
| **UI: Design-system compliance (tokens/colors/typography verified)** | ☑ pass / ☐ fail / ☐ N/A | Tokens file `src/client/tokens.css`. Playwright computed-style check (`expectTokens` in `e2e/sign-in.e2e.ts`): each element's computed value equals the value its token resolves to — body `color`/`background-color`/`font-family`/`font-size`; h1 `font-size`/`font-weight`; button `background-color`/`color`/`font-size`/`font-weight`/`padding-left`; main `padding-top`/`padding-left`; `.empty` `background-color`/`padding-top`; test 1 `✓`. Hex-literal lint: `bun run lint` → `check-tokens: 0 color literals outside src/client/tokens.css`. |
| **UI: Responsiveness at target viewports** | ☑ pass / ☐ fail / ☐ N/A | 360×740, 768×1024, 1280×800 on `/` and `/ladders`: test asserts `document.documentElement.scrollWidth <= viewport width` at each (pass, no overflow); sign-in button `boundingBox().height >= 44` at 360 px (pass; `--tap-min: 44px`). Desktop column max-width `--content-max: 40rem`. |

---

## Demonstration

> Anchors what this task delivered to an observable before/after pair. BEFORE has no `N/A` path:
> if the task changes executable code, BEFORE is a pasted, timestamped terminal capture taken
> **before any implementation commit exists**; if it does not (docs, templates, skill-instruction
> text), BEFORE is the **verbatim prior content** of what changed — a quoted excerpt, not a command.

**BEFORE**: captured by common-infrastructure in worktree `/home/thunderkds/workspace/pets/wt-t003`,
branch `T003-scaffold`, HEAD `c4b20ab`, before any implementation commit (the guide's Verification Command):

```
2026-11-12T08:05:53Z
c4b20ab
$ docker compose up -d db
no configuration file provided: not found
exit=1
$ bun install --frozen-lockfile
error: Bun could not find a package.json file to install from
note: Run "bun init" to initialize a project
exit=1
$ bun run db:migrate
error: Script not found "db:migrate"
exit=1
$ bun run typecheck
error: Script not found "typecheck"
exit=1
$ bun run test:e2e -- sign-in
error: Script not found "test:e2e"
exit=1
$ bun run ci:local
error: Script not found "ci:local"
exit=1
```

**AFTER**: same commands, same worktree, HEAD `8987ac6`, 2026-11-12T08:29:33Z (grouped as in the guide):

```
$ docker compose up -d db
 Container wt-t003-db-1 Running
exit=0
$ bun install --frozen-lockfile
Checked 38 installs across 94 packages (no changes) [4.00ms]
exit=0
$ bun run db:migrate && bun run db:migrate:down && bun run db:migrate
applied: 0001_init
reverted: 0001_init
applied: 0001_init
exit=0
$ bun run typecheck && bun run lint && bun test
Checked 28 files in 15ms. No fixes applied.
check-tokens: 0 color literals outside src/client/tokens.css
 34 pass
 0 fail
exit=0
$ bun run test:e2e -- sign-in
  ✓  1 e2e/sign-in.e2e.ts:37:1 › sign-in tracer: GitHub sign-in lands on an empty My ladders page (726ms)
  ✓  2 e2e/sign-in.e2e.ts:78:1 › sign-out: the old session no longer opens My ladders (469ms)
  ✓  3 e2e/sign-in.e2e.ts:97:1 › signed out, /ladders redirects to / (148ms)
  3 passed
exit=0
$ bun run ci:local        (2026-11-12T08:32:34Z)
ci:local: all steps passed
exit=0
```

**DELTA**: A learner can now sign in with GitHub (against the test stub) and land on an empty "My ladders" page backed by a migrated Postgres + pgvector database, and the whole check runs with one command (`bun run ci:local`). Not yet observed: sign-in with a real GitHub OAuth app (needs the owner's client id in `.env`).

**WITNESS**: [who ran it and when — derived from `memory/event-trace/Txxx.jsonl`, never the
implementing agent alone]
