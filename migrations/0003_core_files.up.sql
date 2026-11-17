-- T006: the repo reader's picks (core_files) and the file cache it reads through (repo_file_cache), per repo + SHA.
-- Job statuses gain 'picking' (step pick-core-files running) and 'picked' (core files stored).

ALTER TABLE generation_jobs DROP CONSTRAINT generation_jobs_status_check;
ALTER TABLE generation_jobs ADD CONSTRAINT generation_jobs_status_check
  CHECK (status IN ('queued', 'running', 'fetched', 'picking', 'picked', 'failed'));

-- File text at the pinned SHA, so a retried step re-reads nothing from GitHub. content is NULL for a binary file.
-- readFile keeps at most 1 MB (1,048,576 bytes), which decodes to at most as many characters.
CREATE TABLE repo_file_cache (
  repo_full_name text NOT NULL,
  commit_sha text NOT NULL,
  path text NOT NULL CHECK (path <> '' AND path !~ '(^/|(^|/)\.\.?(/|$))'),
  content text CHECK (char_length(content) <= 1048576),
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (repo_full_name, commit_sha, path),
  FOREIGN KEY (repo_full_name, commit_sha) REFERENCES repo_snapshots (repo_full_name, commit_sha) ON DELETE CASCADE
);

CREATE TABLE core_files (
  repo_full_name text NOT NULL,
  commit_sha text NOT NULL,
  rank smallint NOT NULL CHECK (rank BETWEEN 1 AND 10),
  path text NOT NULL,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (repo_full_name, commit_sha, rank),
  UNIQUE (repo_full_name, commit_sha, path),
  FOREIGN KEY (repo_full_name, commit_sha) REFERENCES repo_snapshots (repo_full_name, commit_sha) ON DELETE CASCADE
);
