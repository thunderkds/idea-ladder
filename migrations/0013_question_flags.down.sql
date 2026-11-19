-- LOSSY, throwaway databases only: drops every flag and the `removed` status (a removed question becomes active again).
-- The runner refuses down unless MIGRATE_ALLOW_DOWN=1 and always refuses when NODE_ENV=production.
ALTER TABLE mcqs DROP COLUMN status;
ALTER TABLE review_cards DROP COLUMN status;
DROP TABLE question_flags;
