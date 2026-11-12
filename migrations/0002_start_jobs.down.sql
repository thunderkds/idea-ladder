-- DESTRUCTIVE: drops ladders, generation jobs, repo snapshots and confidence rows. Throwaway databases only.
-- The runner refuses down unless MIGRATE_ALLOW_DOWN=1 and always refuses when NODE_ENV=production.
DROP TABLE repo_confidence;
DROP TABLE repo_snapshots;
DROP TABLE generation_job_waiters;
DROP TABLE generation_jobs;
DROP TABLE ladders;
