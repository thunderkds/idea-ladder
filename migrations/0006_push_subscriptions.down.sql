-- DESTRUCTIVE: drops every push subscription (learners must turn reminders on again). Throwaway databases only.
-- The runner refuses down unless MIGRATE_ALLOW_DOWN=1 and always refuses when NODE_ENV=production.
DROP TABLE push_subscriptions;
