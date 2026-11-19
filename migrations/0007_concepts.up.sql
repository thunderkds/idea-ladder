-- T007: the concept mapper's output per repo + SHA (shared, like core_files), the learner's own edited list per
-- ladder, and job statuses 'mapping' (step map-concepts running) and 'mapped' (concepts stored).

ALTER TABLE generation_jobs DROP CONSTRAINT generation_jobs_status_check;
ALTER TABLE generation_jobs ADD CONSTRAINT generation_jobs_status_check
  CHECK (status IN ('queued', 'running', 'fetched', 'picking', 'picked', 'mapping', 'mapped', 'failed'));

-- Shared mapping: 3-6 rows per repo + SHA (position 1..6). basis holds core-file paths or readme/topics/languages/depFiles.
CREATE TABLE repo_concepts (
  repo_full_name text NOT NULL,
  commit_sha text NOT NULL,
  position smallint NOT NULL CHECK (position BETWEEN 1 AND 6),
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 60),
  slug text NOT NULL CHECK (slug <> ''),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 300),
  basis jsonb NOT NULL CHECK (jsonb_typeof(basis) = 'array' AND jsonb_array_length(basis) >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (repo_full_name, commit_sha, position),
  UNIQUE (repo_full_name, commit_sha, slug),
  FOREIGN KEY (repo_full_name, commit_sha) REFERENCES repo_snapshots (repo_full_name, commit_sha) ON DELETE CASCADE
);

-- One learner's edited list for one ladder; never touches repo_concepts. concepts: [{ name, slug }] (3-6, validated in code).
CREATE TABLE learner_concepts (
  user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  ladder_id bigint NOT NULL REFERENCES ladders (id) ON DELETE CASCADE,
  concepts jsonb NOT NULL CHECK (jsonb_typeof(concepts) = 'array' AND jsonb_array_length(concepts) BETWEEN 3 AND 6),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, ladder_id)
);
