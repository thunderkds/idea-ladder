-- DESTRUCTIVE: drops every MCQ attempt and evidence record. Throwaway databases only.
-- The runner refuses down unless MIGRATE_ALLOW_DOWN=1 and always refuses when NODE_ENV=production.
DROP TABLE evidence_records;
DROP FUNCTION evidence_records_append_only();
DROP TABLE mcq_attempts;
