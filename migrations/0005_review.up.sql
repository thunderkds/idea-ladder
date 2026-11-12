-- T011: review cards, each learner's FSRS card state, and the append-only review log.
-- T008 writes review_cards; T011 only reads them. A card with no card_states row is New and due now.

CREATE TABLE review_cards (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ladder_id bigint NOT NULL REFERENCES ladders (id) ON DELETE CASCADE,
  level text NOT NULL CHECK (level IN ('L0', 'L1', 'L2', 'L3', 'L4')),
  front text NOT NULL,
  back text NOT NULL
);

CREATE INDEX review_cards_ladder_level_idx ON review_cards (ladder_id, level);

-- The ts-fsrs 5.4.2 Card fields, written only by src/server/review.ts from scheduleNext output.
CREATE TABLE card_states (
  learner_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  card_id bigint NOT NULL REFERENCES review_cards (id) ON DELETE CASCADE,
  due timestamptz NOT NULL,
  stability double precision NOT NULL,
  difficulty double precision NOT NULL,
  elapsed_days integer NOT NULL,
  scheduled_days integer NOT NULL,
  learning_steps integer NOT NULL,
  reps integer NOT NULL,
  lapses integer NOT NULL,
  state smallint NOT NULL CHECK (state BETWEEN 0 AND 3), -- ts-fsrs State: 0 New, 1 Learning, 2 Review, 3 Relearning
  last_review timestamptz,
  PRIMARY KEY (learner_id, card_id)
);

CREATE INDEX card_states_learner_due_idx ON card_states (learner_id, due);

-- One row per rating. No cascade: a card or learner with review history cannot be deleted row by row.
CREATE TABLE review_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  learner_id bigint NOT NULL REFERENCES users (id),
  card_id bigint NOT NULL REFERENCES review_cards (id),
  rating text NOT NULL CHECK (rating IN ('again', 'hard', 'good', 'easy')),
  state_before jsonb NOT NULL,
  state_after jsonb NOT NULL,
  reviewed_at timestamptz NOT NULL,   -- server time, the same instant passed to ts-fsrs
  elapsed_ms double precision NOT NULL CHECK (elapsed_ms >= 0),
  idempotency_key text NOT NULL,
  UNIQUE (learner_id, idempotency_key)
);

CREATE INDEX review_log_learner_card_idx ON review_log (learner_id, card_id, id);

CREATE FUNCTION review_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'review_log is append-only: % is not allowed', TG_OP;
END;
$$;

CREATE TRIGGER review_log_append_only
  BEFORE UPDATE OR DELETE ON review_log
  FOR EACH ROW EXECUTE FUNCTION review_log_append_only();
