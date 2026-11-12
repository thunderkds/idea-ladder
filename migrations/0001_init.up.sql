-- T003: pgvector extension, GitHub-bound users, server-side sessions.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE users (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  github_id bigint NOT NULL UNIQUE,   -- identity key: GitHub numeric id, never the login
  github_login text NOT NULL,         -- display only; updated on every sign-in
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id text PRIMARY KEY,                -- HMAC-SHA256 of the cookie token; the token itself is never stored
  user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);
