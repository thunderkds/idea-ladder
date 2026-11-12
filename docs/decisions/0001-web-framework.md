# 0001 — Server HTTP layer, migration tool, OAuth/session approach

**Date**: 2026-11-12 · **Task**: T003 · **Status**: accepted (Supervisor copies to `memory/decisions.md`)

Fixed by the user on 2026-11-12, not compared here: Bun (runtime, package manager, `bun test`), a React
client built with Vite, Postgres + pgvector.

Hard constraints from `tasks/TASK_GUIDE_T003.md` Approach step 1: TypeScript; server routes for
`/start?url=` and the OAuth callback; hosts an Inngest serve handler and Vercel AI SDK calls on Bun; can ship
a PWA (service worker) later; not tied to one host (T018 decides hosting).

## 1. Server HTTP layer — decision: Hono 4.13.13

| Candidate | Routes + cookies | Inngest serve adapter | Portability (T018) | Test ergonomics | Verdict |
|---|---|---|---|---|---|
| `Bun.serve` + `routes` | Built in; cookies by hand | `inngest/bun` | Bun only | Needs a real server per test | Fewest deps, but we would hand-write cookie parsing and middleware |
| **Hono** | Router, `hono/cookie`, `serveStatic` | `inngest/hono` (used in the smoke check) | Bun, Node, Deno, Workers, Vercel, Lambda adapters | `app.request()` in-process, no port | **Chosen** |
| Elysia | Router, cookies, typed schemas | No first-party adapter; generic `fetch` handler | Bun first; Node adapter is newer | `app.handle()` in-process | Bun-centric; extra type-system weight we do not need |

Reasons: Hono is a thin layer over the web-standard `fetch` handler, so `Bun.serve({ fetch: app.fetch })`
stays the runtime contract and nothing ties the app to one host. It has an Inngest adapter, cookie helpers
with `HttpOnly`/`SameSite`/`Secure`, and in-process tests. A PWA later is static files plus a service worker
served by Vite's build output, which any of the three can serve.

## 2. Migration tool — decision: a ~100-line SQL runner on Bun's built-in `SQL` client

| Candidate | Down migrations | Driver | Verdict |
|---|---|---|---|
| **Own runner** (`src/server/migrate.ts`) | Yes: `NNNN_name.up.sql` + `.down.sql` | `Bun.SQL` (built in, also used by the app) | **Chosen** |
| node-pg-migrate 9.0.0 | Yes | Needs `pg`: a second Postgres driver | Two drivers for one database |
| drizzle-kit | No reversible down | Brings an ORM + schema DSL | Fails AC 1 (`db:migrate:down`) |
| Kysely migrator | Yes, TS migrations | Needs a Bun SQL dialect (third party) | Adds a query builder no task asked for |

Behaviour: each migration file runs in one transaction with `pg_advisory_xact_lock`, so a failure leaves no
half-applied schema and two runners cannot apply the same file. A missing extension fails with
`extension "<name>" is not installed on this Postgres server`. `db:migrate:down` reverts the most recent
migration; reverting the last one also drops `schema_migrations` (empty schema). Down is destructive and must
not run in production without the T018 runbook.

## 3. OAuth / session — decision: hand-written GitHub web flow + server-side sessions in Postgres

| Candidate | Stub-able base URLs (test plan) | Tables it imposes | Verdict |
|---|---|---|---|
| **Hand-written** (`src/server/github.ts`, `src/server/auth.ts`) | Yes, from `GITHUB_OAUTH_BASE_URL` / `GITHUB_API_BASE_URL` | Our `users` + `sessions` only | **Chosen** |
| arctic 3.7.0 | No: GitHub endpoints are hard-coded | None | Cannot point at the test stub without patching |
| Auth.js / better-auth | Partly | Their own accounts/sessions/verification tables | Far more surface than one provider needs |

Details: scope `read:user` only; no `redirect_uri` is sent, so GitHub uses the callback registered on the
OAuth app and the server never trusts the request `Host`. `state` is 32 random bytes in a 10-minute
`HttpOnly; SameSite=Lax` cookie, signed with `SESSION_SECRET` (HMAC-SHA256) together with its issue time, and
compared in constant time. The cookie is cleared on every callback. The identity key is GitHub's numeric `id`;
the login is updated on each sign-in. The session cookie holds 32 random bytes; Postgres stores only
`HMAC-SHA256(SESSION_SECRET, token)`, with a 30-day expiry. The GitHub access token is discarded after the
`/user` call (cut list: T013 decides if one is stored).

## 4. Bun smoke check: Inngest serve handler + Vercel AI SDK call — PASS

Run 2026-11-12T08:08:54Z in a throwaway scratch project (not committed; Inngest and the AI SDK are T005/T006
dependencies). Versions: bun 1.4.3, inngest 4.24.0, inngest-cli 1.46.0, ai 7.0.143, @ai-sdk/openai 4.0.96,
hono 4.13.13. Setup: a Hono app on `Bun.serve` hosts `serve()` from `inngest/hono`; one Inngest function runs
`step.run("call-model", generateText(...))` against a local OpenAI-compatible stub endpoint (no API key is
needed to prove the runtime path); the Inngest dev server (`inngest-cli dev --no-discovery -u ...`) syncs the
app, receives an event and invokes the function over HTTP.

```
2026-11-12T08:08:54Z
bun 1.4.3 serving on 3999
event sent 01M77CTYN1QRDETM7C7Q5PM7T5
run status: Completed output: ""
SMOKE PASS: Inngest step ran generateText on Bun -> pong
exit=0
```

Not proven: a real model provider over the network (no API key in this environment) and Inngest Cloud
signing keys. T005/T006 own those.

## Cut list (deliberately not built)

Inngest and AI SDK wiring (T005/T006); PWA manifest and service worker (T015); deploy config (T018); sign-in
providers other than GitHub; storing the GitHub access token (T013); account deletion and profile settings;
pixel-diff screenshot assertions (baselines are stored in `e2e/baseline/`; fonts differ between WSL and CI
runners, so a diff gate would flake until a pinned font/container exists); session-row cleanup job for
expired sessions (expired rows are ignored by the lookup; a later task can purge them).
