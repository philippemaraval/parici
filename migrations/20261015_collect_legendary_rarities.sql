-- Reviewed legendary cards use rarity 5, independently of fragment progress.
ALTER TABLE cards DROP CONSTRAINT IF EXISTS cards_base_rarity_check;
ALTER TABLE cards ADD CONSTRAINT cards_base_rarity_check CHECK(base_rarity BETWEEN 1 AND 5);
ALTER TABLE cards DROP CONSTRAINT IF EXISTS cards_current_rarity_check;
ALTER TABLE cards ADD CONSTRAINT cards_current_rarity_check CHECK(current_rarity BETWEEN 1 AND 5);
ALTER TABLE cards DROP CONSTRAINT IF EXISTS cards_rarity_override_check;
ALTER TABLE cards ADD CONSTRAINT cards_rarity_override_check CHECK(rarity_override BETWEEN 1 AND 5);
ALTER TABLE cards DROP CONSTRAINT IF EXISTS cards_base_rarity_override_check;
ALTER TABLE cards ADD CONSTRAINT cards_base_rarity_override_check CHECK(base_rarity_override BETWEEN 1 AND 5);
ALTER TABLE card_rarity_history DROP CONSTRAINT IF EXISTS card_rarity_history_old_rarity_check;
ALTER TABLE card_rarity_history ADD CONSTRAINT card_rarity_history_old_rarity_check CHECK(old_rarity BETWEEN 1 AND 5);
ALTER TABLE card_rarity_history DROP CONSTRAINT IF EXISTS card_rarity_history_new_rarity_check;
ALTER TABLE card_rarity_history ADD CONSTRAINT card_rarity_history_new_rarity_check CHECK(new_rarity BETWEEN 1 AND 5);
