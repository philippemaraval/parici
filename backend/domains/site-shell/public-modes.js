"use strict";
async function publicModes(pool) {
  const { rows } = await pool.query(`SELECT
    COALESCE((SELECT value_text::timestamptz<=NOW() FROM app_settings WHERE key='collect_launch_at'),FALSE) AS collect_public,
    COALESCE((SELECT value_text='true' FROM app_settings WHERE key='explorer_public'),FALSE) AS explorer_public`);
  return {
    collect: !!rows[0]?.collect_public,
    explorer: !!rows[0]?.explorer_public,
  };
}
module.exports = { publicModes };
