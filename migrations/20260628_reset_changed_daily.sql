-- The 2026-06-28 target changed after players had started the Daily.
-- Reset every attempt for that date so player state and both Daily leaderboards
-- are rebuilt exclusively from the replacement target.
DELETE FROM daily_user_attempts
WHERE date = '2026-06-28';
