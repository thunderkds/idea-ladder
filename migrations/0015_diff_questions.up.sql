-- T014: diff questions after L2. One question set per attempt on a verified L2 artifact, and its 5 questions.
-- Purely additive: two new tables. No existing table or row is changed.

-- One row per attempt (attempt 1 comes from the T013 artifact event, each retake adds one). The status is the one the
-- PWA reads; only code moves it. correct / submitted_at are set by the one accepted submit.
CREATE TABLE diff_question_sets (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  artifact_id bigint NOT NULL REFERENCES artifacts (id) ON DELETE CASCADE,
  attempt integer NOT NULL CHECK (attempt >= 1),
  status text NOT NULL CHECK (
    status IN ('generating', 'ready', 'diff-questions-unavailable', 'diff-not-testable', 'passed', 'failed')
  ),
  reason text CHECK (length(reason) <= 200),
  created_at timestamptz NOT NULL,
  submitted_at timestamptz,
  correct integer CHECK (correct BETWEEN 0 AND 5),
  CHECK ((submitted_at IS NULL) = (correct IS NULL) AND (correct IS NULL) = (status NOT IN ('passed', 'failed'))),
  UNIQUE (artifact_id, attempt)
);

-- Exactly 5 rows per ready set, written in one transaction. The key never leaves the server.
CREATE TABLE diff_questions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  set_id bigint NOT NULL REFERENCES diff_question_sets (id) ON DELETE CASCADE,
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 4),
  question text NOT NULL CHECK (length(question) BETWEEN 1 AND 500),
  options jsonb NOT NULL CHECK (jsonb_typeof(options) = 'array' AND jsonb_array_length(options) = 4),
  key text NOT NULL,
  -- `<file path>#<hunk index>` of the hunk the code check verified the key against.
  hunk_id text NOT NULL CHECK (length(hunk_id) <= 1100),
  UNIQUE (set_id, position)
);
