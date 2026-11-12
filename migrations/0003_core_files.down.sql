-- DESTRUCTIVE: drops the reader's core-file picks and the file cache. Throwaway databases only.
-- The runner refuses down unless MIGRATE_ALLOW_DOWN=1 and always refuses when NODE_ENV=production.
-- Jobs in the two new statuses go back to 'fetched' (their snapshot exists) so the old CHECK holds again.
DROP TABLE core_files;
DROP TABLE repo_file_cache;
UPDATE generation_jobs SET status = 'fetched', updated_at = now() WHERE status IN ('picking', 'picked');
ALTER TABLE generation_jobs DROP CONSTRAINT generation_jobs_status_check;
ALTER TABLE generation_jobs ADD CONSTRAINT generation_jobs_status_check
  CHECK (status IN ('queued', 'running', 'fetched', 'failed'));
