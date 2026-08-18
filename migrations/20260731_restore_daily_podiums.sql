CREATE TABLE IF NOT EXISTS daily_podium_carryovers (
  username_key TEXT PRIMARY KEY,
  first_places INTEGER NOT NULL DEFAULT 0 CHECK (first_places >= 0),
  second_places INTEGER NOT NULL DEFAULT 0 CHECK (second_places >= 0),
  third_places INTEGER NOT NULL DEFAULT 0 CHECK (third_places >= 0),
  weeks_played INTEGER NOT NULL DEFAULT 0 CHECK (weeks_played >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO daily_podium_carryovers (
  username_key,
  first_places,
  second_places,
  third_places,
  weeks_played,
  updated_at
)
VALUES
  ('robz2295', 3, 2, 0, 5, NOW()),
  ('mphil', 2, 3, 0, 5, NOW()),
  ('victoire', 0, 0, 4, 4, NOW())
ON CONFLICT (username_key) DO UPDATE SET
  first_places = EXCLUDED.first_places,
  second_places = EXCLUDED.second_places,
  third_places = EXCLUDED.third_places,
  weeks_played = EXCLUDED.weeks_played,
  updated_at = NOW();
