-- Up Migration
-- Additive: two new tables and two new job statuses. No existing row or column changes.
-- Widening a CHECK list needs no rewrite of existing rows; every existing status stays valid.

CREATE TABLE repo_file_cache (
  repo_full_name text NOT NULL CHECK (repo_full_name = lower(repo_full_name)),
  commit_sha text NOT NULL CHECK (commit_sha ~ '^[0-9a-f]{40}$'),
  path text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('text', 'binary', 'too-large')),
  -- NULL unless kind = 'text'. Text only: a NUL byte makes a file binary before it reaches this column.
  content text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (repo_full_name, commit_sha, path),
  CHECK ((kind = 'text') = (content IS NOT NULL))
);

CREATE TABLE core_files (
  repo_full_name text NOT NULL CHECK (repo_full_name = lower(repo_full_name)),
  commit_sha text NOT NULL CHECK (commit_sha ~ '^[0-9a-f]{40}$'),
  rank integer NOT NULL CHECK (rank >= 1),
  path text NOT NULL,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (repo_full_name, commit_sha, rank),
  UNIQUE (repo_full_name, commit_sha, path),
  FOREIGN KEY (repo_full_name, commit_sha) REFERENCES repo_snapshots (repo_full_name, commit_sha) ON DELETE CASCADE
);

ALTER TABLE generation_jobs DROP CONSTRAINT generation_jobs_status_check;
ALTER TABLE generation_jobs ADD CONSTRAINT generation_jobs_status_check
  CHECK (status IN ('queued', 'running', 'fetched', 'picking', 'picked', 'failed'));

-- Down Migration
-- Drops every row in the two new tables. Jobs in the new statuses go back to `fetched` first, so the old CHECK holds.
UPDATE generation_jobs SET status = 'fetched' WHERE status IN ('picking', 'picked');
ALTER TABLE generation_jobs DROP CONSTRAINT generation_jobs_status_check;
ALTER TABLE generation_jobs ADD CONSTRAINT generation_jobs_status_check
  CHECK (status IN ('queued', 'running', 'fetched', 'failed'));
DROP TABLE IF EXISTS core_files;
DROP TABLE IF EXISTS repo_file_cache;
