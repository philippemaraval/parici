-- Remove only the production test account's result for the active 2026-07-22 Daily.
DELETE FROM daily_user_attempts AS attempt
USING users AS account
WHERE attempt.user_id = account.id
  AND LOWER(TRIM(account.username)) = 'test'
  AND attempt.date = '2026-07-22';
