-- Up Migration
-- Additive only: four new tables, no change to users or sessions.
-- repo_full_name is stored lower-cased everywhere so "Developit/Mitt" and "developit/mitt" share a cache key.

CREATE TABLE ladders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_full_name text NOT NULL CHECK (repo_full_name = lower(repo_full_name)),
  commit_sha text NOT NULL CHECK (commit_sha ~ '^[0-9a-f]{40}$'),
  status text NOT NULL DEFAULT 'unverified',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (repo_full_name, commit_sha)
);

CREATE TABLE generation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_full_name text NOT NULL CHECK (repo_full_name = lower(repo_full_name)),
  commit_sha text NOT NULL CHECK (commit_sha ~ '^[0-9a-f]{40}$'),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'fetched', 'failed')),
  reason text,
  reset_at timestamptz,
  started_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One open (not failed) job per repo + SHA. A failed job does not block a new one.
CREATE UNIQUE INDEX generation_jobs_open_key ON generation_jobs (repo_full_name, commit_sha) WHERE status <> 'failed';

CREATE TABLE repo_snapshots (
  repo_full_name text NOT NULL CHECK (repo_full_name = lower(repo_full_name)),
  commit_sha text NOT NULL CHECK (commit_sha ~ '^[0-9a-f]{40}$'),
  default_branch text NOT NULL,
  archived boolean NOT NULL DEFAULT false,
  readme text NOT NULL,
  topics jsonb NOT NULL,
  languages jsonb NOT NULL,
  dep_files jsonb NOT NULL,
  open_issues integer NOT NULL,
  good_first_issues integer NOT NULL,
  tree jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (repo_full_name, commit_sha)
);

CREATE TABLE repo_confidence (
  repo_full_name text NOT NULL,
  commit_sha text NOT NULL,
  score numeric(3, 2) NOT NULL CHECK (score >= 0 AND score <= 1),
  level text NOT NULL CHECK (level IN ('low', 'medium', 'high')),
  fallback_to_concepts boolean NOT NULL,
  reasons jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (repo_full_name, commit_sha),
  FOREIGN KEY (repo_full_name, commit_sha) REFERENCES repo_snapshots (repo_full_name, commit_sha) ON DELETE CASCADE
);

-- Down Migration
-- Drops every row in the four tables. Never run in production without the T018 runbook.
DROP TABLE IF EXISTS repo_confidence;
DROP TABLE IF EXISTS repo_snapshots;
DROP TABLE IF EXISTS generation_jobs;
DROP TABLE IF EXISTS ladders;
