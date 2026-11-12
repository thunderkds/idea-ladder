# TASK_REVIEW — T015: Offline PWA (service worker cache), push reminders, export/import of progress

> Sibling of `tasks/TASK_GUIDE_T015.md`. Everything here is **filled by the reviewer at Stage
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

## Evidence

| Check | Result | Notes / output snippet |
|-------|--------|------------------------|
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☑ pass | tests/offline-sync.test.ts (22: sync order, duplicates, client reviewedAt window at the exact boundaries, replay after offline batches, two devices, learnerId/409), tests/push.test.ts (8: subscribe validation, host allowlist incl. jmt17.google.com, unsubscribe isolation), tests/reminders.test.ts (9: local hour in a stored timezone incl. +5:30 and +14, only with due cards, 20 h gap, 404/410 deletion, VAPID unset), tests/progress.test.ts (12: export, import rules, wrong account 403, 413 before parsing, 400s with nothing written), tests/settings-page.test.ts (2), tests/migrate.test.ts `T015 0006_push_subscriptions`, tests/config.test.ts and tests/repo-config.test.ts (VAPID all-or-none), e2e/pwa.e2e.ts (17: manifest and worker, install offer, offline review with IndexedDB queue and ordered sync, 401 keeps the queue, sign-out syncs first, learnerId and 409, network drop mid-session, offline notice, reminders, export, import, 403 detail). `bun test -t T015` = 59 pass. |
| Verification command run | ☑ pass | Supervisor run 2026-11-12T13:36Z at 08b0fa4: `bun install --frozen-lockfile` (no changes); `bun run typecheck` clean; `bun run lint` "Checked 76 files ... No fixes applied.", "check-tokens: 0 color literals outside src/client/tokens.css"; `bun test -t "T015"` = 59 pass, 0 fail, 446 expect() calls; `bunx playwright test --grep T015` = 17 passed (24.5s). |
| Negative cases hold | ☑ pass | Backend mutation checks, 12 of 12 killed (each changed one place, the relevant test file failed, code restored, `git diff --stat` empty): reviewInstant dropped `client > last` (3 fail), `<=` to `<` (1 fail), `+ 1` ms (1 fail); import skip branches duplicate / notRateable / olderThanServer / futureTime removed (2, 1, 1, 1 fail); 404-only, 410-only and no-DELETE in the reminder (1 fail each). Fix batch: every fix test failed before the change (host: `Expected: true Received: false`; wrong learner: `Expected 409 Received 200`; detail bodies; frontend: 5 e2e failed before the fixes, e.g. `Expected pattern: /\/$/ Received: .../review`). Independent QA on the real app (qa-t015 scripts, HEAD 58f492e): AC 1-3 and 5-7 PASS with ts-fsrs replay matching card_states for every card (incl. 2006 rows); AC 4 FAILED once (the push host allowlist refused a real Chromium endpoint jmt17.google.com), fixed in 6821961 and re-verified by the Supervisor on a real Chromium: `POST /api/push/subscribe 200`, on survives a reload, off removes it, no console error. Also re-verified by the Supervisor on the real app: a 401 keeps the queue and the same learner's next sign-in syncs it with the same idempotency key; another account's session gets `409 wrong-learner`, nothing written, no alert, no retry loop; the network dropping mid-session continues offline and the queued key reaches the server. |
| verify | ☐ pass / ☐ fail / ☐ N/A | [leave it: the auto verify hook writes this row, with its run record. If you ran /verify yourself, tick pass and make the whole Notes cell "/verify by the user, session <id>, commit <sha>" (the full 40-character commit). The merge gate counts no other row, even with the word "pass" in it] |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | ☑ pass | code-review (reports/code-review_T015-offline-pwa_20261112T195706.html and the after-fixes report): 0 P0, 1 P1 (a 401 wiped the offline queue: fixed in d42f5e7, verified), 2 P2 (lane EXCEEDS 64 files / 4495 lines vs C2 14/500, raised to the Supervisor; T011 memory entry to update), 5 P3 left open; QA added P2 F3 (queue under another account: fixed 15cbba2 + 1ca469a) and F6 (network drop mid-session: fixed eed1705), P3 F4 (403/413 detail: fixed c39270d). security-review (reports/security-review_T015-offline-pwa_20261112T201520.html): 0 findings at confidence 8+. migration-safety on 0006_push_subscriptions: GO by hand (the backend agent had no Skill tool); the dry-run-on-production-data box is N/A (no production database, same as 0005). Skipped: T003-T011 code (unchanged except `rateCard`/`reviewInstant`), experiments/. |
| Full smoke suite still green (no regression) | ☑ pass | `npm run test` at 08b0fa4: 232 pass, 0 fail, 1151 expect() calls, 18 files (baseline 174). `bun run test:e2e` (sign-in, start-flow, ladder-view, review, pwa): 45 passed (1.2m); T011's 11 review tests still pass. |
| **Companion score (easy-verifier)** | ☑ N/A | easy-verifier not installed; not run. |
| **UI: Visual regression (diff or verdict pasted)** | ☑ pass | 21 baselines e2e/baseline/pwa-*.png and settings-*.png (offline review front/back, install offer, offline /start, settings default, blocked, import error) at 360/768/1280; the frontend agent read each and wrote "matches spec" verdicts; independent QA read real-app screenshots at 375 and 1280 (offline review with banner, settings, offline settings, install offer, import error, offline /start): no layout problem. The fix batch changed no UI, so no baseline was re-taken. |
| **UI: Design-system compliance (tokens/colors/typography verified)** | ☑ pass | Computed-style checks in e2e/pwa.e2e.ts: banner, offline notice, install offer, settings sections, buttons, select, h2 and main max-width resolve to tokens.css custom properties; manifest theme_color equals --color-accent and background_color --color-bg; `bun run lint` check-tokens: 0 color literals outside tokens.css; the icon generator reads its colors from tokens.css; text >= 16 px. |
| **UI: Responsiveness at target viewports** | ☑ pass | 360/768/1280 (and 375 by QA): every checked button, link, select and file input >= 44 x 44 px with >= 8 px gaps; scrollWidth <= viewport at 360, 768 and 1280 for every captured state; settings stack in one column; axe 0 serious/critical on offline front/back, install offer, offline start, settings default, blocked, import error, iOS hint, no-pack screen. ux-evaluate (baseline checks, applied by hand by the frontend agent): 9 pass. |

---

## Demonstration

> Anchors what this task delivered to an observable before/after pair. BEFORE has no `N/A` path:
> if the task changes executable code, BEFORE is a pasted, timestamped terminal capture taken
> **before any implementation commit exists**; if it does not (docs, templates, skill-instruction
> text), BEFORE is the **verbatim prior content** of what changed — a quoted excerpt, not a command.

**BEFORE**: captured by backend-developer in `/home/thunderkds/workspace/pets/wt-t015` (branch `T015-offline-pwa`)
at `8b897c4`, before any T015 implementation commit. No T015 test exists, none of the three dependencies is declared,
and every PWA / settings / push / progress / offline-pack URL is a 404 for a signed-in learner (`octo`, stub GitHub).

```
$ date -u; git rev-parse --short HEAD
2026-11-12T12:15:46Z
8b897c4
$ bun test -t "T015"
bun test v1.4.3 (c6da4a4d3)

error: regex "T015" matched 0 tests. Searched 13 files (skipping 174 tests) [116.00ms]
$ grep -n "web-push\|\"idb\"\|\"zod\"" package.json
exit=1
```

```
$ bun run build && bun e2e/serve.ts      # ports 54400-54402, stopped after the capture
$ date -u
2026-11-12T12:16:07Z
$ curl -s -L -c jar -b jar -o /dev/null -w "%{http_code} %{url_effective}\n" http://localhost:54401/auth/github
200 http://localhost:54401/ladders
$ curl -si -b jar http://localhost:54401/manifest.webmanifest | head -1
HTTP/1.1 404 Not Found
$ curl -si -b jar http://localhost:54401/sw.js | head -1
HTTP/1.1 404 Not Found
$ curl -si -b jar http://localhost:54401/settings | head -1
HTTP/1.1 404 Not Found
$ curl -si -b jar http://localhost:54401/api/push/status | head -1
HTTP/1.1 404 Not Found
$ curl -si -b jar http://localhost:54401/api/progress/export | head -1
HTTP/1.1 404 Not Found
$ curl -si -b jar http://localhost:54401/api/review/offline-pack | head -1
HTTP/1.1 404 Not Found
```

**AFTER**: 2026-11-12T13:36Z, worktree wt-t015 at 08b0fa4 (Supervisor run), same commands as BEFORE:

```
$ bun test -t "T015"
 59 pass
 173 filtered out
 0 fail
 446 expect() calls

$ bunx playwright test --grep T015
  17 passed (24.5s)

$ grep -n 'web-push\|"idb"\|"zod"' package.json
"idb": "8.0.4", "web-push": "3.6.7", "zod": "3.25.76"  (exact pins)
```

Real app, Supervisor drive on `bun e2e/serve.ts` (HEAD 08b0fa4): a real Chromium (persistent profile) pressed `Turn on reminders` on `/settings`: `POST /api/push/subscribe 200` for an endpoint on host `jmt17.google.com`, the page says "On: every day at 07:00 (Asia/Bangkok), only when cards are due.", it survives a reload, `Turn off reminders` sends `POST /api/push/unsubscribe 200`. Offline: after one online visit `/review` loads offline from the cached pack with the Offline banner; a rating is queued in IndexedDB; with the session expired the sync answers 401, the queue is kept and the page goes to `/`; after the same learner signs in again the rating is sent with its original idempotency key and the log has the row. With another account's cookie the sync answers `409 wrong-learner`, the queue stays, nothing is written. The independent QA also showed: manifest `application/manifest+json`, installable (`Page.getInstallabilityErrors` empty), ts-fsrs replay of the log equals card_states for every card after offline sync, a doctored import file changed nothing but its one valid new row, the cron sent at the learner's local hour in Asia/Kolkata and Pacific/Kiritimati only with due cards.

**DELTA**: a learner can install the app, review their due cards with no network (ratings queue on the device and sync in order to the server, which recomputes every state with the same scheduler), get one daily push reminder at their chosen hour only when cards are due, and export and re-import their review progress without ever creating proof or unlocking a level, where before the app had no manifest, no service worker, no sync, no reminders and no export or import (all of `/manifest.webmanifest`, `/sw.js`, `/settings` and `/api/push/*`, `/api/progress/*`, `/api/review/offline-pack` returned 404).

**WITNESS**: [who ran it and when — derived from `memory/event-trace/Txxx.jsonl`, never the
implementing agent alone]
