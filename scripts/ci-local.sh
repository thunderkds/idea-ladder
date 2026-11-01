#!/usr/bin/env bash
# Runs the same steps as .github/workflows/ci.yml, against the local docker compose database.
set -euo pipefail
cd "$(dirname "$0")/.."
export DATABASE_URL="${DATABASE_URL:-postgres://idea_ladder:idea_ladder@localhost:54329/idea_ladder}"

docker compose up -d --wait db
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm db:migrate:down
pnpm db:migrate
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
echo "ci:local passed"
