# TASK_REVIEW — T034: Local dev sign-in without a GitHub OAuth app

> Sibling of `tasks/TASK_GUIDE_T034.md`. Everything here is **filled by the reviewer at Stage
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
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☑ pass | Implementer (backend-developer), 2026-11-25. New: `tests/dev-login.test.ts` (25 tests; describes `T034 dev sign-in (AC 4, AC 7)`, `T034 dev sign-in fails closed (AC 5)`, `T034 author check reads the dev sign-in id (AC 7, NFR-003)`; real Postgres, stub GitHub API on a local port, real `createApp`). Added: `tests/config.test.ts` describe `T034 dev login config (DEV_LOGIN_GITHUB_LOGIN)` (8 tests: AC 1, AC 2 incl. a spawned `src/server/main.ts` that exits 1 before it listens, AC 3). Changed: `tests/repo-config.test.ts` (`.env.example` list gains `DEV_LOGIN_GITHUB_LOGIN=`, AC 8). Output, 2026-11-25T09:10:23Z, `DATABASE_URL=postgres://postgres:postgres@localhost:54329/idea_ladder bun test -t "T034"`: `33 pass` / `0 fail` / `Ran 33 tests across 66 files. [1.80s]`. Loopback bind (Supervisor decision, `src/server/main.ts` now calls `Bun.serve({ port: config.port, hostname: listenHostname(config), fetch: app.fetch })`): 2 more tests in the same describe, `listenHostname: loopback only (127.0.0.1) in dev login mode, else unchanged (undefined)` (unit) and `main.ts in dev login mode answers on 127.0.0.1 and not on a non-loopback address` (spawns `main.ts`; `/api/me` on 127.0.0.1 → 401; fetch to the machine's LAN IPv4 must fail). RED on the old `main.ts`, 09:14:57Z: `Expected: "192.168.0.104: false"` / `Received: "192.168.0.104: true"` / `0 pass` `1 fail`. GREEN after the change: see the next row (`35 pass`). |
| Verification command run | ☑ pass | Implementer, 2026-11-25T09:10:23Z, local Docker DB only. `bun install --frozen-lockfile` → `Checked 388 installs across 345 packages (no changes)`; `bun run typecheck` → `$ tsc --noEmit` (no errors); `bun run lint` → `Checked 166 files in 94ms. No fixes applied.` / `check-tokens: 0 color literals outside src/client/tokens.css`; `bun test -t "T034"` → `33 pass` `0 fail` `Ran 33 tests across 66 files.`; `bun test -t "T003"` → `1 pass` `0 fail` `Ran 1 test across 66 files.`; `exit=0`. Note: `-t "T003"` matches only the `.env.example` test in `tests/repo-config.test.ts`; the T003 sign-in tests in `tests/auth.test.ts` have no "T003" in their names. So they were run by file, 2026-11-25T09:10:31Z: `bun test tests/auth.test.ts tests/repo-config.test.ts tests/config.test.ts tests/dev-login.test.ts tests/artifact-routes.test.ts` → `91 pass` `0 fail` `Ran 91 tests across 5 files.` (`tests/auth.test.ts` unchanged, AC 6). Re-run after the loopback bind, 2026-11-25T09:14:57Z, `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54329/idea_ladder`: `Checked 388 installs across 345 packages (no changes)`; `$ tsc --noEmit` (no errors); `Checked 166 files in 95ms. No fixes applied.` / `check-tokens: 0 color literals outside src/client/tokens.css`; `bun test -t "T034"` → `35 pass` `0 fail` `Ran 35 tests across 66 files. [2.42s]`; `bun test -t "T003"` → `1 pass` `0 fail` `Ran 1 test across 66 files.`; `bun test tests/auth.test.ts` → `22 pass` `0 fail` `Ran 22 tests across 1 file.`; `exit=0`. |
| Negative cases hold | ☑ pass | Implementer. Fail closed (AC 5), each a 400 `Sign-in failed` page, no session cookie, 0 users, 0 sessions: 404, rate limit 403, 502, `id` "x"/0/-5/1.5/missing, `login` missing/non-string, a different login, non-JSON body, JSON `null`, network error (nothing listening). Log line has no `GITHUB_APP_TOKEN`, no `SESSION_SECRET`, no response body. Direct `/auth/github/callback` in dev mode: 400 and no stub request. Guard (AC 2): `NODE_ENV` production, test, unset, "", "Development", "dev", "staging" → `ConfigError` `DEV_LOGIN_GITHUB_LOGIN is allowed only with NODE_ENV=development`. Bad logins (`-octo`, `octo-`, `oc--to`, 40 chars, space, `_`, `../admin`, `oc/to`, `é`) → `ConfigError` that does not contain the value. Bad `next` (`https://evil.example/`, `//evil.example`, `/admin`) → `/ladders`. |
| verify | ☐ pass / ☐ fail / ☐ N/A | [what was observed — must literally state "pass" or "fail" here too, e.g. "skill run, feature confirmed working — pass": the merge gate scans this Notes column for the word "pass", not just the Result column] |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | ☐ pass / ☐ fail | [what was reviewed vs. skipped, and why] |
| Full smoke suite still green (no regression) | ☑ pass | Implementer, 2026-11-25T09:10:47Z, `DATABASE_URL=postgres://postgres:postgres@localhost:54329/idea_ladder bun test` → `695 pass` / `0 fail` / `Ran 695 tests across 66 files. [95.70s]`, exit 0. (Stage 4/5 reviewer to confirm.) |
| **Companion score (easy-verifier)** | ☐ pass / ☐ fail / ☐ N/A | [`overall` and `change_risk` as the tool returned them, the scope, the ref, and the absolute path of the verifier report after a literal `report:` label — e.g. "overall 86 (>= 80), change_risk pass, scope changes, ref `main...HEAD`, report: `/home/me/.easy-verifier-reports/kit/score_changes_20261028T0530Z.html`". The gate reads the path that follows `report:` and nothing else, so with no label, or a path that is absent, the row is unscored — write ☑ N/A instead. ☑ N/A with a reason when neither companion tool was run: the merge gate blocks on ☑ fail only, never on an absent or N/A row] |
| **UI: Visual regression (diff or verdict pasted)** | ☑ N/A | Pure backend task: no file under `src/client/**` changed (TASK_GUIDE Out of scope: no login form, no client change). |
| **UI: Design-system compliance (tokens/colors/typography verified)** | ☑ N/A | Pure backend task: no UI change. |
| **UI: Responsiveness at target viewports** | ☑ N/A | Pure backend task: no UI change. |

---

## Demonstration

> Anchors what this task delivered to an observable before/after pair. BEFORE has no `N/A` path:
> if the task changes executable code, BEFORE is a pasted, timestamped terminal capture taken
> **before any implementation commit exists**; if it does not (docs, templates, skill-instruction
> text), BEFORE is the **verbatim prior content** of what changed — a quoted excerpt, not a command.

**BEFORE**: captured 2026-11-25T09:00:49Z in `/home/thunderkds/workspace/pets/hungnguyen111/wt-t034` (branch `T034-dev-login`, HEAD `0f51156`, no implementation commit yet):

```
$ date -u +%Y-%m-%dT%H:%M:%SZ; NODE_ENV=development DATABASE_URL=postgres://u:p@localhost/db GITHUB_APP_TOKEN=x SESSION_SECRET=$(printf 'a%.0s' {1..32}) DEV_LOGIN_GITHUB_LOGIN=octocat bun -e 'import {loadConfig} from "./src/server/config.ts"; try{loadConfig(process.env)}catch(e){console.log(String(e))}'
2026-11-25T09:00:49Z
Error: Invalid configuration: missing required environment variable(s): GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
```

**AFTER**: captured 2026-11-25T09:10:40Z, same worktree, after the change (the first command prints the loaded dev login and the empty OAuth values; the second is the production guard):

```
$ date -u +%Y-%m-%dT%H:%M:%SZ; NODE_ENV=development DATABASE_URL=postgres://u:p@localhost/db GITHUB_APP_TOKEN=x SESSION_SECRET=$(printf 'a%.0s' {1..32}) DEV_LOGIN_GITHUB_LOGIN=octocat bun -e 'import {loadConfig} from "./src/server/config.ts"; try{const c=loadConfig(process.env); console.log("ok", c.devLoginGithubLogin, JSON.stringify([c.githubClientId, c.githubClientSecret]))}catch(e){console.log(String(e))}'
2026-11-25T09:10:40Z
ok octocat ["",""]
$ NODE_ENV=production DATABASE_URL=postgres://u:p@localhost/db GITHUB_APP_TOKEN=x SESSION_SECRET=$(printf 'a%.0s' {1..32}) DEV_LOGIN_GITHUB_LOGIN=octocat bun -e 'import {loadConfig} from "./src/server/config.ts"; try{loadConfig(process.env)}catch(e){console.log(String(e))}'
Error: Invalid configuration: DEV_LOGIN_GITHUB_LOGIN is allowed only with NODE_ENV=development; production requires: INNGEST_SIGNING_KEY, INNGEST_EVENT_KEY, INNGEST_SERVE_ORIGIN
```

**DELTA**: The owner can run the app in development with `DATABASE_URL`, `GITHUB_APP_TOKEN`, `SESSION_SECRET` and `DEV_LOGIN_GITHUB_LOGIN`, and sign in as their real GitHub account (numeric id) with no OAuth app; outside development the server refuses to start with that variable set.

**WITNESS**: [who ran it and when — derived from `memory/event-trace/Txxx.jsonl`, never the
implementing agent alone]
