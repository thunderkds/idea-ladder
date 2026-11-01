-- Up Migration
-- Additive only: four new tables, no change to users, sessions or the T005 tables.
-- cards: minimal shape; T008 writes it. card_states: one FSRS state per learner and card (created by the first rating).
-- review_log: append-only, one row per rating; a trigger rejects UPDATE and DELETE.

CREATE TABLE cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ladder_id uuid NOT NULL REFERENCES ladders (id) ON DELETE CASCADE,
  level_id text NOT NULL CHECK (level_id IN ('L0', 'L1', 'L2', 'L3', 'L4')),
  front text NOT NULL,
  back text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX cards_ladder_level_idx ON cards (ladder_id, level_id);

-- A card with no row here is New for that learner. state: 0 New, 1 Learning, 2 Review, 3 Relearning (ts-fsrs State).
CREATE TABLE card_states (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  card_id uuid NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
  due timestamptz NOT NULL,
  stability double precision NOT NULL,
  difficulty double precision NOT NULL,
  elapsed_days integer NOT NULL,
  scheduled_days integer NOT NULL,
  learning_steps integer NOT NULL,
  reps integer NOT NULL,
  lapses integer NOT NULL,
  state smallint NOT NULL CHECK (state BETWEEN 0 AND 3),
  last_review timestamptz,
  PRIMARY KEY (user_id, card_id)
);

CREATE INDEX card_states_user_due_idx ON card_states (user_id, due);

-- user_id and card_id use RESTRICT on purpose: deleting a learner or a card that has reviews must be a
-- deliberate step (the append-only trigger blocks the log rows), not a silent cascade.
CREATE TABLE review_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id),
  card_id uuid NOT NULL REFERENCES cards (id),
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 4),
  state_before jsonb NOT NULL,
  state_after jsonb NOT NULL,
  reviewed_at timestamptz NOT NULL,
  elapsed_ms integer NOT NULL CHECK (elapsed_ms >= 0),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 128),
  UNIQUE (user_id, idempotency_key)
);

CREATE INDEX review_log_user_card_idx ON review_log (user_id, card_id, id);
CREATE INDEX review_log_user_reviewed_idx ON review_log (user_id, reviewed_at);

CREATE FUNCTION review_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'review_log is append-only: % is not allowed', TG_OP USING ERRCODE = 'restrict_violation';
END
$$;

CREATE TRIGGER review_log_no_update_delete
  BEFORE UPDATE OR DELETE ON review_log
  FOR EACH ROW EXECUTE FUNCTION review_log_append_only();

-- Down Migration
-- Drops every card, learner card state and review log row. Never run in production without the T018 runbook.
DROP TRIGGER IF EXISTS review_log_no_update_delete ON review_log;
DROP FUNCTION IF EXISTS review_log_append_only();
DROP TABLE IF EXISTS review_log;
DROP TABLE IF EXISTS card_states;
DROP TABLE IF EXISTS cards;
