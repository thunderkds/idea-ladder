# Idea Ladder (v1 app)

Hono (TypeScript) server, Postgres + pgvector, GitHub OAuth sign-in. Decision record: `docs/decisions/0001-web-framework.md`.

## Run locally

```bash
docker compose up -d --wait db          # pgvector Postgres on 127.0.0.1:54329
cp .env.example .env                    # fill in the four values; DATABASE_URL is
                                        # postgres://idea_ladder:idea_ladder@localhost:54329/idea_ladder
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm dev                                # http://localhost:3000
```

Create a GitHub OAuth app (Settings > Developer settings > OAuth Apps) with callback URL
`http://localhost:3000/auth/github/callback`, then put its client id and secret in `.env`.
Make `SESSION_SECRET` at least 32 random characters (`openssl rand -base64 48`).

## Checks

`pnpm typecheck`, `pnpm lint`, `pnpm test` (needs the database), `pnpm test:e2e` (Playwright with a stub GitHub),
`pnpm ci:local` (all of CI).

`pnpm db:migrate:down` drops every app table and the `vector` extension, with their rows. Use it on local databases only.
