-- Up Migration
-- Additive only: one new table, no change to existing tables. generation_jobs.started_by stays as written.
-- One row per learner who started a ladder for repo + SHA (cache hit, joined an open job, or created the job).
-- Keyed by repo + SHA, not ladder id, so the row exists before the ladder is saved.

CREATE TABLE ladder_learners (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  repo_full_name text NOT NULL CHECK (repo_full_name = lower(repo_full_name)),
  commit_sha text NOT NULL CHECK (commit_sha ~ '^[0-9a-f]{40}$'),
  started_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, repo_full_name, commit_sha)
);

-- Keep every learner My ladders showed before this table: one row per started_by + repo + SHA, any job status.
INSERT INTO ladder_learners (user_id, repo_full_name, commit_sha, started_at)
SELECT started_by, repo_full_name, commit_sha, min(created_at)
FROM generation_jobs
WHERE started_by IS NOT NULL
GROUP BY started_by, repo_full_name, commit_sha
ON CONFLICT DO NOTHING;

-- Down Migration
-- Drops every learner record. Rows copied from started_by can be rebuilt by running up again; rows for cache-hit
-- and joined learners cannot. Never run in production without the T018 runbook.
DROP TABLE IF EXISTS ladder_learners;
