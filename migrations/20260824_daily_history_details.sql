ALTER TABLE daily_user_attempts
  ADD COLUMN IF NOT EXISTS total_distance_meters INTEGER;

ALTER TABLE daily_user_attempts
  ADD COLUMN IF NOT EXISTS score INTEGER NOT NULL DEFAULT 0;

ALTER TABLE daily_user_attempts
  ADD COLUMN IF NOT EXISTS solve_time_seconds DOUBLE PRECISION;

UPDATE daily_user_attempts
SET
  score = CASE WHEN success THEN GREATEST(0, 8 - LEAST(attempts_count, 7)) ELSE 0 END,
  solve_time_seconds = CASE
    WHEN success AND started_at IS NOT NULL AND last_attempt_at IS NOT NULL
      THEN GREATEST(0, EXTRACT(EPOCH FROM (last_attempt_at - started_at)))
    ELSE NULL
  END;

CREATE TABLE IF NOT EXISTS daily_attempt_details (
  id BIGSERIAL PRIMARY KEY,
  daily_user_attempt_id INTEGER NOT NULL REFERENCES daily_user_attempts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  attempt_number INTEGER NOT NULL CHECK (attempt_number BETWEEN 1 AND 7),
  distance_meters INTEGER NOT NULL CHECK (distance_meters >= 0),
  success BOOLEAN NOT NULL DEFAULT FALSE,
  elapsed_seconds DOUBLE PRECISION NOT NULL CHECK (elapsed_seconds >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, date, attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_daily_attempt_details_date_user
  ON daily_attempt_details (date DESC, user_id, attempt_number);
