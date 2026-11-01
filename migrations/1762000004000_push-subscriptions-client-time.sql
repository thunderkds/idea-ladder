-- Up Migration
-- Additive only. One new table (Web Push subscriptions with the learner's reminder hour and IANA timezone)
-- and one new column on review_log. No existing column or row is changed.
-- ADD COLUMN with a constant default is a metadata-only change on Postgres 11+ (no table rewrite, no row
-- trigger runs), so the append-only trigger on review_log is not involved and the lock is brief.

CREATE TABLE push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE CHECK (length(endpoint) BETWEEN 1 AND 2048),
  p256dh text NOT NULL CHECK (length(p256dh) BETWEEN 1 AND 256),
  auth text NOT NULL CHECK (length(auth) BETWEEN 1 AND 256),
  reminder_hour smallint NOT NULL CHECK (reminder_hour BETWEEN 0 AND 23),
  timezone text NOT NULL CHECK (length(timezone) BETWEEN 1 AND 64),
  -- The learner's local date of the last push, so a repeated hourly tick never sends twice in one day.
  last_sent_on date,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (user_id);

-- True when the client's reviewedAt was not accepted and the server used its own time.
ALTER TABLE review_log ADD COLUMN client_time_rejected boolean NOT NULL DEFAULT false;

-- Down Migration
-- Drops every push subscription (learners turn reminders on again) and the client_time_rejected flags.
ALTER TABLE review_log DROP COLUMN IF EXISTS client_time_rejected;
DROP TABLE IF EXISTS push_subscriptions;
