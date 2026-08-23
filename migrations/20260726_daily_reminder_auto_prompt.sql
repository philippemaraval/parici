ALTER TABLE users
ADD COLUMN IF NOT EXISTS daily_reminder_prompted_at TIMESTAMPTZ;

UPDATE users u
SET daily_reminder_prompted_at = COALESCE(u.daily_reminder_prompted_at, NOW())
WHERE u.daily_reminder_prompted_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM push_subscriptions ps
    WHERE ps.user_id = u.id
      AND ps.enabled = TRUE
  );
