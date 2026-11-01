# 0001 — Web framework, migration tool, OAuth and session approach

Date: 2026-11-01 · Task: T003 · Status: accepted (auto mode, no user question asked)

Note: the `brainstorming` skill was not callable in this sub-agent run (no Skill tool). The comparison below is the
same exercise done inline against the guide's hard constraints.

## Decision

- Web framework: **Hono on Node** (`@hono/node-server`), server-rendered pages with `hono/jsx`, plain CSS with design tokens.
- Database access: `pg`. Migrations: **`node-pg-migrate`** with plain `.sql` files (`-- Up Migration` / `-- Down Migration`).
- Sign-in: hand-written GitHub OAuth (authorization-code flow, scope `read:user`). Sessions: random token in an
  HttpOnly cookie; only an HMAC-SHA256 of the token (keyed by `SESSION_SECRET`) is stored in `sessions`.

## Options compared

| Constraint | Next.js | SvelteKit | Hono + Node (chosen) |
|---|---|---|---|
| TypeScript | yes | yes | yes |
| Server routes for `/start?url=` and OAuth callback | yes (route handlers) | yes (`+server.ts`) | yes (plain routes) |
| Hosts an Inngest serve handler | yes (`inngest/next`) | yes (`inngest/sveltekit`) | yes (`inngest/hono`) |
| Runs Vercel AI SDK calls, streaming | yes | yes | yes (plain `Response` streams) |
| PWA service worker later | needs a plugin or a hand-written `public/sw.js` | `src/service-worker.ts` built in | a static file in `public/` plus a manifest route |
| Not tied to one host | best on Vercel; self-host works but needs more care | adapters per host, good | runs on Node, containers, Workers, Bun, Vercel with the same code |
| Surface to learn and pin | largest (React, bundler, caching rules) | medium (Svelte, Vite, adapters) | smallest |

Why Hono: the app is a small server with a few pages and a durable workflow behind it. It needs the least framework
for the same constraints, has no host-specific build output, and keeps request handling plain `Request`/`Response`,
which tests call directly with `app.request()`. It also matches the project's "no cleverness in the trust path" rule:
auth code is short enough to read in one sitting.

Trade-offs accepted:
- No client-side framework. Interactive review screens (T0xx) will add client JavaScript as islands or a Vite build
  then. A later switch of the view layer does not touch routes, sessions or the database.
- The OAuth flow is about 100 lines of our own code, not a library. Chosen because the identity-binding rule
  (key by numeric GitHub `id`, scope `read:user` only, no token stored) is easier to prove in our own code than to
  configure in a library.

## Migration tool

`node-pg-migrate`: SQL files with explicit up and down, each migration in one transaction (a failed
`CREATE EXTENSION vector` leaves no half-applied schema), a lock against concurrent runs, no ORM. Rejected:
Drizzle Kit and Prisma (down migrations are not first-class; ORM layer not needed yet), hand-rolled runner (no gain).

## OAuth and session

- `state`: 24 random bytes. The cookie holds `<state>.<issuedAtMs>.<hmac>`, HttpOnly, SameSite=Lax, 10 minutes,
  path `/auth/github`. The callback checks the HMAC, the age, and the query `state` in constant time.
- Identity key: GitHub numeric `id` (`users.github_id`, unique). The login is a label, refreshed on every sign-in.
- The GitHub access token is used once to read `/user`, then dropped (not stored).
- Session cookie `il_session`: HttpOnly, SameSite=Lax, `Secure` unless `APP_BASE_URL` is localhost / 127.0.0.1, 30 days.
- GitHub base URLs come from `GITHUB_OAUTH_BASE_URL` / `GITHUB_API_BASE_URL` (default github.com / api.github.com) so
  tests use a local stub.

## Cut list (not built)

Inngest and AI SDK wiring (T005/T006), PWA (T015), deploy config (T018), other sign-in providers, token storage,
account deletion, profile page, rate limiting on `/auth/*`, session cleanup job for expired rows.
