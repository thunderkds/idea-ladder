-- DESTRUCTIVE / lossy: re-adds both columns as NULLABLE and empty. The dropped vectors do not come back.
-- Throwaway databases only.
-- The runner refuses down unless MIGRATE_ALLOW_DOWN=1 and always refuses when NODE_ENV=production.
ALTER TABLE chunks ADD COLUMN embedding vector(1536);
ALTER TABLE chunks ADD COLUMN embedding_model text;
