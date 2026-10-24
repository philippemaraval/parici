"use strict";
// This runs in the startup transaction, under the schema advisory lock.
// Preserve an existing launch and never move the cut-off on later deployments.
async function launchDailyRewards(client) {
  await client.query(`
    WITH launch AS (
      INSERT INTO app_settings(key, value_text, updated_at)
      VALUES ('parici_daily_collect_launch', NOW()::text, NOW())
      ON CONFLICT (key) DO NOTHING RETURNING value_text
    )
    UPDATE app_settings SET value_text = launch.value_text, updated_at = NOW()
    FROM launch WHERE key = 'collect_launch_at'
      AND (app_settings.value_text IS NULL OR app_settings.value_text = 'infinity')
  `);
}
module.exports = { launchDailyRewards };
