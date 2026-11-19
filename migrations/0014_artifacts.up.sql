-- T013: verified GitHub artifacts (L2 branch, L4 repo or merged PR) and the optional L1 run feedback.
-- Purely additive: two new tables. No existing table or row is changed.

-- One row per verified artifact state. head_sha is the proof: the branch head (L2), the default-branch head (L4 repo)
-- or the merge commit (L4 PR) at verification time; a force-push later does not change it.
-- The same URL at the same head is one row (a resubmission is idempotent); a new head is a new row.
CREATE TABLE artifacts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  learner_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  ladder_id bigint NOT NULL REFERENCES ladders (id) ON DELETE CASCADE,
  level text NOT NULL CHECK (level IN ('L2', 'L4')),
  kind text NOT NULL CHECK (kind IN ('branch', 'repo', 'pr')),
  url text NOT NULL CHECK (length(url) <= 2048),
  repo_full_name text NOT NULL,
  head_sha text NOT NULL CHECK (head_sha ~ '^[0-9a-f]{40}$'),
  verified_at timestamptz NOT NULL,
  CHECK ((level = 'L2') = (kind = 'branch')),
  UNIQUE (learner_id, ladder_id, level, url, head_sha)
);

-- L1 feedback only (option B): never scored, never in an evidence record. One row per learner + ladder, replaced on save.
CREATE TABLE run_feedback (
  learner_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  ladder_id bigint NOT NULL REFERENCES ladders (id) ON DELETE CASCADE,
  run_log text NOT NULL CHECK (length(run_log) <= 20000),
  explanation text NOT NULL CHECK (length(explanation) <= 600),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (learner_id, ladder_id)
);
