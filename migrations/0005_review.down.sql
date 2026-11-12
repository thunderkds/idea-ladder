-- DESTRUCTIVE: drops every review card, card state and review log row. Throwaway databases only.
-- The runner refuses down unless MIGRATE_ALLOW_DOWN=1 and always refuses when NODE_ENV=production.
DROP TABLE review_log;
DROP FUNCTION review_log_append_only();
DROP TABLE card_states;
DROP TABLE review_cards;
