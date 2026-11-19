-- T031: no embedding model (user decision 2026-11-19). Chunks stay (they are the citation targets); their vectors
-- and the model name that made them go. Every existing row keeps id, path, lines and text.
-- DESTRUCTIVE for the stored vectors: they were never read by any code. The `vector` extension stays (0001).
ALTER TABLE chunks DROP COLUMN embedding;
ALTER TABLE chunks DROP COLUMN embedding_model;
