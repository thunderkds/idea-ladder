-- DESTRUCTIVE: drops the shared concept mappings and every learner's edited concept list. Throwaway databases only.
-- The runner refuses down unless MIGRATE_ALLOW_DOWN=1 and always refuses when NODE_ENV=production.
-- Jobs in the two new statuses go back to 'picked' (their core files exist) so the old CHECK holds again.
DROP TABLE learner_concepts;
DROP TABLE repo_concepts;
UPDATE generation_jobs SET status = 'picked', updated_at = now() WHERE status IN ('mapping', 'mapped');
ALTER TABLE generation_jobs DROP CONSTRAINT generation_jobs_status_check;
ALTER TABLE generation_jobs ADD CONSTRAINT generation_jobs_status_check
  CHECK (status IN ('queued', 'running', 'fetched', 'picking', 'picked', 'failed'));
