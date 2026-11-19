-- T008 (8a): grounding chunks per repo + SHA (shared, like core_files) with their embeddings (step chunk-and-embed).
-- Embedding model and dimension: docs/decisions/0006-generation.md (text-embedding-3-small, 1536). Later T008
-- subtasks add their own tables in later migrations.

-- One row per chunk; id is the chunkId generators cite. A re-run for the same repo + SHA writes the same
-- (source, path, ordinal) keys, so it adds no row. The text is raw file text at the pinned SHA.
CREATE TABLE chunks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  repo_full_name text NOT NULL,
  commit_sha text NOT NULL,
  source text NOT NULL CHECK (source IN ('readme', 'docs', 'dep', 'core')),
  path text NOT NULL CHECK (path <> ''),
  ordinal integer NOT NULL CHECK (ordinal >= 0),          -- position of the chunk within its file
  start_line integer NOT NULL CHECK (start_line >= 1),
  end_line integer NOT NULL CHECK (end_line >= start_line),
  text text NOT NULL CHECK (text <> ''),
  embedding vector(1536) NOT NULL,
  embedding_model text NOT NULL CHECK (embedding_model <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (repo_full_name, commit_sha, source, path, ordinal),
  FOREIGN KEY (repo_full_name, commit_sha) REFERENCES repo_snapshots (repo_full_name, commit_sha) ON DELETE CASCADE
);
