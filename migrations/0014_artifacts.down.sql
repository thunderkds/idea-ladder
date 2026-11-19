-- DESTRUCTIVE: drops every verified artifact row and every L1 run feedback. Throwaway databases only.
-- The runner refuses down unless MIGRATE_ALLOW_DOWN=1 and always refuses when NODE_ENV=production.
-- Evidence records (0011) are not touched: an L4 record keeps its own copy of the artifact URL and SHA.
DROP TABLE run_feedback;
DROP TABLE artifacts;
