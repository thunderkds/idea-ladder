# TASK_REVIEW — T011: Daily 5-minute review with FSRS (ts-fsrs 5.4.2), review log stored

> Sibling of `tasks/TASK_GUIDE_T011.md`. Everything here is **filled by the reviewer at Stage
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
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☑ pass | tests/review-scheduler.test.ts (6: ts-fsrs 5.4.2 pin, all 4 ratings from all 4 card states equal the library, manual rejected); tests/review-api.test.ts (23: AC 1, 2, 3, 6, 7, queue order and caps, due exactly now, locked level, idempotency incl. concurrent, two tabs, 401/404/400, /review page and return target, reviewed_at never moves back, elapsed_ms cap); tests/migrate.test.ts `T011 0005_review` (up/down/up with rows, checks, append-only trigger, FK); e2e/review.e2e.ts (11: AC 4, 5, 6, keyboard, SC 4 fake clock 4:59/5:01, 401, queue error, Start review links, 1 real-server end to end). `bun test -t T011` = 31 pass. |
| Verification command run | ☑ pass | Supervisor run 2026-11-12T11:35Z at 1aee88d: `bun install --frozen-lockfile` (no changes); `bun run typecheck` clean; `bun run lint` "Checked 58 files ... No fixes applied.", "check-tokens: 0 color literals outside src/client/tokens.css"; `bun test -t "T011"` = 31 pass, 0 fail, 199 expect() calls; `bunx playwright test --grep T011` = 11 passed (2.5m). |
| Negative cases hold | ☑ pass | Mutation runs (each made at least one T011 test fail, code restored after): backend `<=` to `<` on the queue; no lock filter in the queue; no ownership or lock check on rating; no append-only trigger; no FOR UPDATE; no duplicate answer; fix batch: `at = now` instead of max(now, last_review) -> `Expected: 2026-11-01T09:00:00.000Z Received: 2026-11-01T08:59:00.000Z`, and elapsed cap -> `-   86400000, +   1e+308`. Frontend: `timeUp = false` -> SC 4 `Expected "Session done" Received "Review"`; a new key per attempt -> AC 6 failed. Independent QA (real server, own scripts): AC 1-7 and 25 probes PASS; log replay with ts-fsrs matched stored card_states for every card (3 match, 0 mismatch, incl. a card rated 11 times); UPDATE/DELETE on review_log rejected; one P2 found (reviewed_at backwards under the row-lock wait) and fixed in 1aee88d. |
| verify | ☑ pass | auto-run by hook, session 34f68f99-705e-43e5-8fdc-11be0dbfc8eb, commit 42909c3caa10dac0fd0e864dffbde43d68f1781b, log .claude/verify-runs/T011-42909c3caa10.log — pass |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | ☑ pass | code-review (reports/code-review_T011-daily-review_20261112T182251.html): scope src/server/review.ts, scheduler.ts, app.ts, src/shared/review.ts, src/client/Review.tsx, App.tsx, LadderView.tsx, styles.css, migrations/0005, tests, e2e; 0 P0, 0 P1, 2 P2 (entry point name fixed in the guide; lane EXCEEDS 33 files/1805 lines vs C2 14/500, 15 are PNG baselines, raised to the Supervisor), 5 P3 left open. security-review (reports/security-review_T011-daily-review_*.html): 0 findings at confidence 8+. migration-safety on 0005_review: GO; the dry-run-on-production-data box accepted as N/A by the user (no production database), recorded in memory/decisions.md. Skipped: T003-T010 code (unchanged), experiments/. |
| Full smoke suite still green (no regression) | ☑ pass | `npm run test` at 1aee88d: 174 pass, 0 fail, 700 expect() calls, 13 files (baseline 143). `bun run test:e2e` (all specs: sign-in, start-flow, ladder-view, review): 28 passed (3.1m). |
| **Companion score (easy-verifier)** | ☑ N/A | easy-verifier not installed; not run. |
| **UI: Visual regression (diff or verdict pasted)** | ☑ pass | Baselines e2e/baseline/review-{front,back,empty,no-cards,session-end}-{mobile,tablet,desktop}.png (15). Frontend agent read each and wrote LLM-vision verdicts "matches spec" at 360/768/1280 (one card, readable question, answer hidden until Show answer, 4 buttons Again/Hard/Good/Easy, timer visible; empty and session-end text present, no layout break). Independent QA read real-app screenshots at 375 and 1280 (qa-t011/ in the session scratchpad): same verdict. Known cosmetic P3: heavy focus outline on the revealed answer. |
| **UI: Design-system compliance (tokens/colors/typography verified)** | ☑ pass | Playwright computed-style checks: body, card, question, level label, timer, Show answer and the 4 rating buttons resolve to tokens.css custom properties; `bun run lint` check-tokens: 0 color literals outside tokens.css; body/answer text 16px; font stack = T010's system-ui stack; rating buttons 146x44 (768/1280) and 80x44 (375/360), gap 8px. QA measured the same on the real app. |
| **UI: Responsiveness at target viewports** | ☑ pass | 360/375/768/1280: scrollWidth equals the viewport (360 at 360, 375 at 375, 768, 1280); 4 buttons in one row at every width; card centred with max width 640 on tablet and desktop; a 120-char unbroken string and long front/back text wrap at 360 (QA longtext run); axe 0 serious/critical on card front/back, rate-error, Nothing due, No cards yet, Session done, queue-error, My ladders and ladder view with Start review. ux-evaluate (frontend agent, baseline checks only): 8 pass, 1 fail (older) = My ladders has no primary action (P3). |

---

## Demonstration

> Anchors what this task delivered to an observable before/after pair. BEFORE has no `N/A` path:
> if the task changes executable code, BEFORE is a pasted, timestamped terminal capture taken
> **before any implementation commit exists**; if it does not (docs, templates, skill-instruction
> text), BEFORE is the **verbatim prior content** of what changed — a quoted excerpt, not a command.

**BEFORE**: captured by backend-developer in `/home/thunderkds/workspace/pets/wt-t011`, branch `T011-daily-review` at
`ba14a6d`, before any T011 implementation commit.

```
$ date -u; bun test -t "T011"
2026-11-12T10:57:04Z
bun test v1.4.3 (c6da4a4d3)

error: regex "T011" matched 0 tests. Searched 11 files (skipping 143 tests) [129.00ms]
(exit code 1)

$ date -u; grep -n "ts-fsrs" package.json
2026-11-12T10:57:04Z
(no output, grep exit=1)

$ bun run build && bun e2e/serve.ts   # BEFORE state
$ curl -si http://localhost:54401/api/review/queue   # signed out
2026-11-12T10:57:41Z
HTTP/1.1 404 Not Found
$ curl -s -c jar -b jar -L -o /dev/null -w '%{http_code} %{url_effective}' http://localhost:54401/auth/github   # sign in as octo via the stub
2026-11-12T10:57:41Z
200 http://localhost:54401/ladders
$ curl -s -b jar http://localhost:54401/api/me   # signed in
{"login":"octo"}
$ curl -si -b jar http://localhost:54401/api/review/queue   # signed in
2026-11-12T10:57:41Z
HTTP/1.1 404 Not Found
$ curl -si -b jar http://localhost:54401/review   # signed in
2026-11-12T10:57:41Z
HTTP/1.1 404 Not Found
```

**AFTER**: 2026-11-12T11:35Z, worktree wt-t011 at 1aee88d (Supervisor run), same commands as BEFORE plus the real app:

```
$ bun test -t "T011"
 31 pass
 143 filtered out
 0 fail
 199 expect() calls

$ bunx playwright test --grep T011
  11 passed (2.5m)

$ grep -n "ts-fsrs" package.json
25:    "ts-fsrs": "5.4.2"
```

Real app (independent QA, `bun e2e/serve.ts`, signed in as `reviewer`): `GET /api/review/queue` -> cards 1, 2, 3 (all open L0), locked L1 cards 4 and 5 absent; `/review` shows `Card 1 of 3`; after a Good rating `{"state":"learning","duplicate":false}`, the same key again `duplicate:true`; signed out `/api/review/queue` -> 401; `/review` signed out -> 302 `/auth/github?next=%2Freview`; as `waiter` the page shows `Nothing due | Next review: Jan 2, 2030, 9:00 AM`; as `octo` `No cards yet`.

**DELTA**: a signed-in learner can open `/review`, see the cards due from their unlocked levels one at a time, rate them Again/Hard/Good/Easy within a 5-minute session, and every rating is scheduled by ts-fsrs 5.4.2 on the server and stored as an append-only log row that replays to the same card state, where before `/review` and `/api/review/*` returned 404.

**WITNESS**: [who ran it and when — derived from `memory/event-trace/Txxx.jsonl`, never the
implementing agent alone]
