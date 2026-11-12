-- DESTRUCTIVE: drops every ladder level row. Throwaway databases only.
-- The runner refuses down unless MIGRATE_ALLOW_DOWN=1 and always refuses when NODE_ENV=production.
DROP TABLE ladder_levels;
