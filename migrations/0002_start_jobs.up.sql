-- T005: ladder cache key (repo + commit SHA), generation jobs and who waits on them, repo snapshots, confidence.
-- Repo names are stored lower-case so `Developit/Mitt` and `developit/mitt` share one cache key.

CREATE TABLE ladders (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  repo_full_name text NOT NULL CHECK (repo_full_name = lower(repo_full_name)),
  commit_sha text NOT NULL CHECK (commit_sha ~ '^[0-9a-f]{40}$'),
  status text NOT NULL,               -- written by T008 (e.g. 'unverified'); T005 only reads ladders
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (repo_full_name, commit_sha)
);

CREATE TABLE generation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_full_name text NOT NULL CHECK (repo_full_name = lower(repo_full_name)),
  commit_sha text NOT NULL CHECK (commit_sha ~ '^[0-9a-f]{40}$'),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'fetched', 'failed')),
  reason text,                        -- set with status 'failed', e.g. 'rate-limited'
  reset_at timestamptz,               -- GitHub rate-limit reset time when reason = 'rate-limited'
  started_by bigint REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- At most one open job per repo + SHA; a failed job does not block a new one.
CREATE UNIQUE INDEX generation_jobs_open_key ON generation_jobs (repo_full_name, commit_sha) WHERE status <> 'failed';

-- Learners allowed to read a job's status: whoever started it and whoever asked for the same repo + SHA since.
CREATE TABLE generation_job_waiters (
  job_id uuid NOT NULL REFERENCES generation_jobs (id) ON DELETE CASCADE,
  user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, user_id)
);

CREATE TABLE repo_snapshots (
  repo_full_name text NOT NULL CHECK (repo_full_name = lower(repo_full_name)),
  commit_sha text NOT NULL CHECK (commit_sha ~ '^[0-9a-f]{40}$'),
  default_branch text NOT NULL,
  archived boolean NOT NULL,
  readme text NOT NULL,
  topics jsonb NOT NULL,
  languages jsonb NOT NULL,
  dep_files jsonb NOT NULL,
  open_issues integer NOT NULL,
  good_first_issues integer NOT NULL,
  tree jsonb NOT NULL,
  tree_truncated boolean NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (repo_full_name, commit_sha)
);

CREATE TABLE repo_confidence (
  repo_full_name text NOT NULL,
  commit_sha text NOT NULL,
  score numeric(3, 2) NOT NULL CHECK (score BETWEEN 0 AND 1),
  level text NOT NULL CHECK (level IN ('low', 'medium', 'high')),
  fallback_to_concepts boolean NOT NULL,
  reasons jsonb NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (repo_full_name, commit_sha),
  FOREIGN KEY (repo_full_name, commit_sha) REFERENCES repo_snapshots (repo_full_name, commit_sha) ON DELETE CASCADE
);
