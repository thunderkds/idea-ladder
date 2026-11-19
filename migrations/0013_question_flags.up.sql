-- T016: a learner flags a review card or an MCQ as wrong. The two id spaces (review_cards, mcqs) share one table,
-- keyed (learner_id, kind, question_id): one flag per learner per question. No foreign key on question_id (two target
-- tables); ids are identity values and never reused. `status` on both content tables: 'removed' hides a question from
-- every queue and pool once enough distinct learners flagged it. Additive only; existing rows become 'active'.
CREATE TABLE question_flags (
  learner_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('card', 'mcq')),
  question_id bigint NOT NULL,
  reason text CHECK (reason IS NULL OR char_length(reason) <= 280),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (learner_id, kind, question_id)
);

CREATE INDEX question_flags_question_idx ON question_flags (kind, question_id);

ALTER TABLE review_cards ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed'));
ALTER TABLE mcqs ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed'));
