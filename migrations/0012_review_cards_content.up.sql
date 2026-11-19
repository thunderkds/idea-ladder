-- T032: one card table. T008 saved generated cards in its own table `cards` (0009), but the review queue, rating,
-- offline pack and reminders read only review_cards (docs/decisions/0003-review-tables.md). Move the content columns
-- onto review_cards, copy every `cards` row (keeping the order of its ids), and drop `cards`.
-- Both new columns are nullable: a hand-seeded row has neither. NULL positions do not collide in the unique index.

ALTER TABLE review_cards
  ADD COLUMN position integer CHECK (position >= 0),
  ADD COLUMN chunk_id bigint REFERENCES chunks (id);

-- A rolled-back 0012 (down) leaves its copies in review_cards without the columns. Pair each `cards` row with such a
-- copy (same ladder, level, front, back; the n-th of its kind with the n-th) so up again fills it, not duplicates it.
CREATE TEMP TABLE adopted ON COMMIT DROP AS
  SELECT c.id AS card_id, r.id AS review_id
  FROM (SELECT id, ladder_id, level, front, back,
          row_number() OVER (PARTITION BY ladder_id, level, front, back ORDER BY id) AS rn FROM cards) c
  JOIN (SELECT id, ladder_id, level, front, back,
          row_number() OVER (PARTITION BY ladder_id, level, front, back ORDER BY id) AS rn FROM review_cards) r
    ON r.ladder_id = c.ladder_id AND r.level = c.level AND r.front = c.front AND r.back = c.back AND r.rn = c.rn;

UPDATE review_cards r SET position = c.position, chunk_id = c.chunk_id
  FROM adopted a JOIN cards c ON c.id = a.card_id
  WHERE r.id = a.review_id;

INSERT INTO review_cards (ladder_id, level, position, front, back, chunk_id)
  SELECT ladder_id, level, position, front, back, chunk_id FROM cards
  WHERE id NOT IN (SELECT card_id FROM adopted)
  ORDER BY id;

DO $$
DECLARE copied bigint; total bigint;
BEGIN
  SELECT count(*) INTO copied FROM review_cards WHERE chunk_id IS NOT NULL;
  SELECT count(*) INTO total FROM cards;
  IF copied <> total THEN
    RAISE EXCEPTION '0012: % cards rows but % review_cards rows with content; refusing to drop cards', total, copied;
  END IF;
END $$;

CREATE UNIQUE INDEX review_cards_ladder_level_position_idx ON review_cards (ladder_id, level, position);

DROP TABLE cards;
