# TASK_REVIEW — T003: Scaffold — TypeScript app, Postgres + pgvector, migrations, GitHub OAuth sign-in, CI

> Sibling of `tasks/TASK_GUIDE_T003.md`. Everything here is **filled by the reviewer at Stage
> 4/5** — it is deliberately NOT in the guide, because the implementing agent re-reads the guide on
> every turn and never fills these two sections.
>
> Consumers resolve each section **guide first, this file second** (`.claude/hooks/lib/guide_sections.py`):
> a legacy guide that still carries these sections inline keeps working unchanged, and a stray
> review file can never override an inline section.

---

## Evidence

| Check | Result | Notes / output snippet |
|-------|--------|------------------------|
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☑ pass (implementer-run; reviewer to confirm) | `test/config.test.ts`, `test/migrations.test.ts`, `test/auth.test.ts`, `test/tokens.test.ts` (vitest: 4 files, 24 tests passed, 2026-11-01T11:14); `e2e/sign-in.spec.ts`, `e2e/ui.spec.ts` (Playwright: 7 passed). Red first: before `src/` existed, `pnpm test` showed `Test Files 4 failed (4)`. |
| Verification command run | ☑ pass (implementer-run) | `pnpm ci:local` (docker compose up --wait db; install --frozen-lockfile; migrate up, down, up; typecheck; lint; test; test:e2e) ended with `ci:local passed`. Also: `pnpm build` ok; `node dist/src/server.js` served `/` 200, `/assets/tokens.css` 200, `/ladders` 302 to `/`; missing env prints `Cannot start: DATABASE_URL is missing; ...` exit 1; migration on `postgres:16` (no pgvector) fails with `pgvector is not installed on this Postgres server` and leaves 0 app tables; `db:migrate:down` with 1 user row drops it, up again ok. |
| Negative cases hold | ☐ pass / ☐ fail | |
| verify | ☐ pass / ☐ fail / ☐ N/A | [what was observed — must literally state "pass" or "fail" here too, e.g. "skill run, feature confirmed working — pass": the merge gate scans this Notes column for the word "pass", not just the Result column] |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | ☐ pass / ☐ fail | [what was reviewed vs. skipped, and why] |
| Full smoke suite still green (no regression) | ☐ pass / ☐ fail | |
| **Companion score (easy-verifier)** | ☐ pass / ☐ fail / ☐ N/A | [`overall` and `change_risk` as the tool returned them, the scope, the ref, and the absolute path of the verifier report after a literal `report:` label — e.g. "overall 86 (>= 80), change_risk pass, scope changes, ref `main...HEAD`, report: `/home/me/.easy-verifier-reports/kit/score_changes_20261028T0530Z.html`". The gate reads the path that follows `report:` and nothing else, so with no label, or a path that is absent, the row is unscored — write ☑ N/A instead. ☑ N/A with a reason when neither companion tool was run: the merge gate blocks on ☑ fail only, never on an absent or N/A row] |
| **UI: Visual regression (diff or verdict pasted)** | ☑ pass (implementer view) | Screenshots `e2e/screenshots/{home,ladders}-{mobile,tablet,desktop}.png`. Read `ladders-mobile.png` and `home-desktop.png`: heading, `No ladders yet`, login `octo`, Sign out visible; one blue Sign in with GitHub button, app name shown, no overflow. Reviewer to give own verdict. |
| **UI: Design-system compliance (tokens/colors/typography verified)** | ☑ pass | `e2e/ui.spec.ts` 'computed styles come from the tokens file' (body/h1/button color, font, size, weight, main padding vs `public/tokens.css` via computed probe); `test/tokens.test.ts` finds 0 hex literals outside `public/tokens.css`. |
| **UI: Responsiveness at target viewports** | ☑ pass | 360x740, 768x1024, 1280x800: `scrollWidth <= viewport`, tap target >= 44px, mobile button > 80% width, desktop column <= 640px. No overflow found. |

---

## Demonstration

> Anchors what this task delivered to an observable before/after pair. BEFORE has no `N/A` path:
> if the task changes executable code, BEFORE is a pasted, timestamped terminal capture taken
> **before any implementation commit exists**; if it does not (docs, templates, skill-instruction
> text), BEFORE is the **verbatim prior content** of what changed — a quoted excerpt, not a command.

**BEFORE**: `2026-11-01T11:08:23+07:00 $ ls package.json pnpm-workspace.yaml` → `ls: cannot access 'package.json': No such file or directory
ls: cannot access 'pnpm-workspace.yaml': No such file or directory` (exit 2)

**AFTER**: `2026-11-01T11:15 $ ls package.json pnpm-lock.yaml docker-compose.yml .github/workflows/ci.yml` lists all four (exit 0); `pnpm ci:local` ends `ci:local passed`.

**DELTA**: A learner can sign in with GitHub (against the test stub; real GitHub run is open) and see an empty `My ladders` page, on a migrated Postgres + pgvector, with CI that runs the same checks.

**WITNESS**: [who ran it and when — derived from `memory/event-trace/Txxx.jsonl`, never the
implementing agent alone]
