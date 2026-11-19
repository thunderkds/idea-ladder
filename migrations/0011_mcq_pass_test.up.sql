-- T012: MCQ pass-test attempts and the append-only evidence records (one per learner + ladder + level passed).
-- Purely additive: two new tables, one trigger function. No existing table or row is changed.

-- One row per started attempt (abandoned ones too: the rate limit counts started attempts).
-- questions: [{ "id": "<mcqs.id>", "order": [i0, i1, i2, i3] }], the shown option order as indexes into mcqs.options.
-- Keys are never copied here: scoring reads them from mcqs.
CREATE TABLE mcq_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  learner_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  ladder_id bigint NOT NULL REFERENCES ladders (id) ON DELETE CASCADE,
  level text NOT NULL CHECK (level IN ('L0', 'L1', 'L2', 'L3', 'L4')),
  questions jsonb NOT NULL CHECK (jsonb_typeof(questions) = 'array' AND jsonb_array_length(questions) > 0),
  started_at timestamptz NOT NULL,
  submitted_at timestamptz,
  correct integer CHECK (correct >= 0),
  passed boolean,
  CHECK ((submitted_at IS NULL) = (correct IS NULL) AND (correct IS NULL) = (passed IS NULL))
);

CREATE INDEX mcq_attempts_learner_level_idx ON mcq_attempts (learner_id, ladder_id, level, started_at);

-- The evidence record JSON, hash included: hash = sha256 over the canonical JSON of the record without "hash".
-- No cascade: a learner or ladder with evidence cannot be deleted row by row (data deletion is T018's).
CREATE TABLE evidence_records (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  learner_id bigint NOT NULL REFERENCES users (id),
  ladder_id bigint NOT NULL REFERENCES ladders (id),
  level text NOT NULL CHECK (level IN ('L0', 'L1', 'L2', 'L3', 'L4')),
  record jsonb NOT NULL CHECK (
    jsonb_typeof(record) = 'object' AND record ->> 'level' = level AND record ->> 'hash' ~ '^sha256:[0-9a-f]{64}$'
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (learner_id, ladder_id, level)
);

CREATE FUNCTION evidence_records_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'evidence_records is append-only: % is not allowed', TG_OP;
END;
$$;

CREATE TRIGGER evidence_records_append_only
  BEFORE UPDATE OR DELETE ON evidence_records
  FOR EACH ROW EXECUTE FUNCTION evidence_records_append_only();
