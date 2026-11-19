-- DESTRUCTIVE: drops every stored chunk and its embedding (a re-run of chunk-and-embed re-creates them, paid).
-- Throwaway databases only.
-- The runner refuses down unless MIGRATE_ALLOW_DOWN=1 and always refuses when NODE_ENV=production.
DROP TABLE chunks;
