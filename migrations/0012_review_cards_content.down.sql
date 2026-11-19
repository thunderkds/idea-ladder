-- LOSSY for ids, throwaway databases only: `cards` is recreated as in 0009 and gets NEW ids (renumbered in review_cards
-- id order). The runner refuses down unless MIGRATE_ALLOW_DOWN=1 and always refuses when NODE_ENV=production.
-- No review_cards row is deleted: review_log may reference it and is append-only. The copies stay as plain
-- review_cards rows; up again pairs them with the `cards` rows, so no card is duplicated.
CREATE TABLE cards (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ladder_id bigint NOT NULL REFERENCES ladders (id) ON DELETE CASCADE,
  level text NOT NULL CHECK (level IN ('L0', 'L1', 'L2', 'L3', 'L4')),
  position integer NOT NULL CHECK (position >= 0),
  front text NOT NULL CHECK (front <> ''),
  back text NOT NULL CHECK (back <> ''),
  chunk_id bigint NOT NULL REFERENCES chunks (id),
  UNIQUE (ladder_id, level, position)
);

INSERT INTO cards (ladder_id, level, position, front, back, chunk_id)
  SELECT ladder_id, level, position, front, back, chunk_id FROM review_cards
  WHERE chunk_id IS NOT NULL AND position IS NOT NULL
  ORDER BY id;

DROP INDEX review_cards_ladder_level_position_idx;
ALTER TABLE review_cards DROP COLUMN chunk_id, DROP COLUMN position;
