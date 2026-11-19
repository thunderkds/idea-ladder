-- DESTRUCTIVE: drops every saved card, MCQ pool and generation report, and the level flags. Throwaway databases only.
-- The runner refuses down unless MIGRATE_ALLOW_DOWN=1 and always refuses when NODE_ENV=production.
-- Jobs in status 'done' go back to 'mapped' (their concepts exist) so the old CHECK holds again.
DROP TABLE generation_reports;
DROP TABLE mcqs;
DROP TABLE cards;
ALTER TABLE ladder_levels DROP COLUMN flags;
UPDATE generation_jobs SET status = 'mapped', updated_at = now() WHERE status = 'done';
ALTER TABLE generation_jobs DROP CONSTRAINT generation_jobs_status_check;
ALTER TABLE generation_jobs ADD CONSTRAINT generation_jobs_status_check
  CHECK (status IN ('queued', 'running', 'fetched', 'picking', 'picked', 'mapping', 'mapped', 'failed'));
