-- T008 (8d): what step save-ladder writes for one ladder: level flags, review cards, MCQ pools, the generation report,
-- and job status 'done'. ladder_levels gets a column only (docs/decisions/0002-ladder-levels-table.md); a level not
-- generated on a concept-only ladder keeps using skip_reason = 'concept-only-skipped'.

ALTER TABLE generation_jobs DROP CONSTRAINT generation_jobs_status_check;
ALTER TABLE generation_jobs ADD CONSTRAINT generation_jobs_status_check
  CHECK (status IN ('queued', 'running', 'fetched', 'picking', 'picked', 'mapping', 'mapped', 'done', 'failed'));

-- 'insufficient-pool': an L0/L3 MCQ pool below 8; 'insufficient-cards': fewer than 5 cards. Never silently empty.
ALTER TABLE ladder_levels ADD COLUMN flags text[] NOT NULL DEFAULT '{}'
  CHECK (flags <@ ARRAY['insufficient-pool', 'insufficient-cards']::text[]);

-- Kept review cards; chunk_id is the chunk the card cites (original text only, NFR-006).
CREATE TABLE cards (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ladder_id bigint NOT NULL REFERENCES ladders (id) ON DELETE CASCADE,
  level text NOT NULL CHECK (level IN ('L0', 'L1', 'L2', 'L3', 'L4')),
  position integer NOT NULL CHECK (position >= 0),
  front text NOT NULL CHECK (front <> ''),
  back text NOT NULL CHECK (back <> ''),
  chunk_id bigint NOT NULL REFERENCES chunks (id),
  UNIQUE (ladder_id, level, position)
);

-- Kept MCQs (the randomized pool, FR-016): 4 options, the key is one of them, checked against chunk_id.
CREATE TABLE mcqs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ladder_id bigint NOT NULL REFERENCES ladders (id) ON DELETE CASCADE,
  level text NOT NULL CHECK (level IN ('L0', 'L1', 'L2', 'L3', 'L4')),
  position integer NOT NULL CHECK (position >= 0),
  question text NOT NULL CHECK (question <> ''),
  options jsonb NOT NULL CHECK (jsonb_typeof(options) = 'array' AND jsonb_array_length(options) = 4),
  key text NOT NULL CHECK (key <> ''),
  chunk_id bigint NOT NULL REFERENCES chunks (id),
  CHECK (options ? key),
  UNIQUE (ladder_id, level, position)
);

-- One report per ladder: generated / kept / dropped per reason per level, cost per step.
CREATE TABLE generation_reports (
  ladder_id bigint PRIMARY KEY REFERENCES ladders (id) ON DELETE CASCADE,
  report jsonb NOT NULL CHECK (jsonb_typeof(report) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
