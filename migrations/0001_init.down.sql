-- DESTRUCTIVE: drops all users and sessions. For throwaway databases only (local dev, tests, CI).
-- The runner refuses down unless MIGRATE_ALLOW_DOWN=1 and always refuses when NODE_ENV=production.
DROP TABLE sessions;
DROP TABLE users;
DROP EXTENSION IF EXISTS vector;
