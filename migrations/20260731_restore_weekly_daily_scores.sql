WITH restored_scores (username_key, attempts_count) AS (
  VALUES
    ('robz2295💚', 3),
    ('victoire', 6),
    ('mphil', 6)
)
INSERT INTO daily_user_attempts (
  user_id,
  date,
  attempts_count,
  best_distance_meters,
  success,
  started_at,
  last_attempt_at
)
SELECT
  users.id,
  '2026-07-27',
  restored_scores.attempts_count,
  NULL,
  TRUE,
  TIMESTAMPTZ '2026-07-27 12:00:00 Europe/Paris',
  TIMESTAMPTZ '2026-07-27 12:00:00 Europe/Paris'
FROM users
JOIN restored_scores
  ON LOWER(TRIM(users.username)) = restored_scores.username_key
ON CONFLICT (user_id, date) DO UPDATE SET
  attempts_count = EXCLUDED.attempts_count,
  best_distance_meters = EXCLUDED.best_distance_meters,
  success = EXCLUDED.success,
  started_at = EXCLUDED.started_at,
  last_attempt_at = EXCLUDED.last_attempt_at;
