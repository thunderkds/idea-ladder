-- T015: one Web Push subscription per browser endpoint, with the learner's daily reminder hour and IANA timezone.
-- Written only by src/server/push.ts (subscribe/unsubscribe) and src/server/reminders.ts (last_sent_at, 404/410 delete).

CREATE TABLE push_subscriptions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  learner_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,      -- the push service URL; a capability, never logged
  p256dh text NOT NULL,               -- the browser's public key (base64url), never logged
  auth text NOT NULL,                 -- the browser's auth secret (base64url), never logged
  reminder_hour smallint NOT NULL CHECK (reminder_hour BETWEEN 0 AND 23), -- local hour in `timezone`
  timezone text NOT NULL,             -- IANA name, checked by the server with Intl.DateTimeFormat
  created_at timestamptz NOT NULL DEFAULT now(),
  last_sent_at timestamptz            -- the last reminder sent; at most one per 20 hours
);

CREATE INDEX push_subscriptions_learner_idx ON push_subscriptions (learner_id);
