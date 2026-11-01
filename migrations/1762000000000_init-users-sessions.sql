-- Up Migration
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
    RAISE EXCEPTION 'pgvector is not installed on this Postgres server (extension "vector" is unavailable). Use a pgvector/pgvector image or install the pgvector package.';
  END IF;
END
$$;

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  github_id bigint NOT NULL UNIQUE,
  github_login text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);

-- Down Migration
-- Drops all rows in users and sessions. Never run in production without the T018 runbook.
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;
DROP EXTENSION IF EXISTS vector;
