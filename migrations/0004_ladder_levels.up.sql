-- T010: the level rows of a ladder (L0-L4). T010 reads them; T008 writes them. A ladder with no rows yet is valid.

CREATE TABLE ladder_levels (
  ladder_id bigint NOT NULL REFERENCES ladders (id) ON DELETE CASCADE,
  level text NOT NULL CHECK (level IN ('L0', 'L1', 'L2', 'L3', 'L4')),
  title text NOT NULL,
  goal text NOT NULL,
  pass_test_kind text NOT NULL,
  pass_test_description text NOT NULL,
  skip_reason text,                   -- 'concept-only-skipped' when the level is not generated for this repo
  PRIMARY KEY (ladder_id, level)
);
