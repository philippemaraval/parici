-- Weights apply to individual cards within their draw group. Population counts
-- already enter the denominator: dividing again by rarity counts would favor
-- individual cards in the smaller rarity pools.
-- Common > uncommon > rare > epic: 2 > 1.5 > 1 > 0.8.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM app_settings WHERE key = 'collect_rarity_draw_balance_v1'
  ) THEN
    INSERT INTO collect_config(key, value_json)
    VALUES ('rarity_draw_weights', '{"1":2,"2":1.5,"3":1,"4":0.8,"5":0.8}'::jsonb)
    ON CONFLICT (key) DO NOTHING;

    -- Upgrade the former uncommon default without changing other weights.
    UPDATE collect_config
    SET value_json = jsonb_set(value_json, '{2}', '1.5'::jsonb), updated_at = NOW()
    WHERE key = 'rarity_draw_weights' AND value_json->'2' = '0.75'::jsonb;

    -- Later administrator changes survive restarts, including a return to 0.75.
    INSERT INTO app_settings(key, value_text, updated_at)
    VALUES ('collect_rarity_draw_balance_v1', 'applied', NOW());
  END IF;
END $$;
