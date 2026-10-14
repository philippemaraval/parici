"use strict";
const crypto = require("node:crypto");
const repairs = require("../../../data/daily_target_repairs_paris.json");
const revision = crypto
  .createHash("sha256")
  .update(JSON.stringify(repairs))
  .digest("hex");
async function applyDailyGeographyRepairs(client) {
  const marker = (
    await client.query(
      "SELECT value_text FROM app_settings WHERE key='parici_daily_geography_revision'",
    )
  ).rows[0];
  if (marker?.value_text === revision) return;
  for (const repair of repairs)
    await client.query(
      `UPDATE daily_targets t SET street_name=$2,arrondissement=$3,coordinates_json=$4,geometry_json=NULL
    WHERE t.date=$1 AND t.date>to_char(NOW() AT TIME ZONE 'Europe/Paris','YYYY-MM-DD')
    AND t.street_name=ANY($5::text[]) AND t.arrondissement IS NOT DISTINCT FROM $6 AND t.image_url IS NULL
    AND NOT EXISTS(SELECT 1 FROM daily_user_attempts p WHERE p.date=t.date)
    AND NOT EXISTS(SELECT 1 FROM admin_entity_revisions r WHERE r.domain='daily' AND r.entity_key=t.date AND r.actor<>'API / synchronisation')`,
      [
        repair.date,
        repair.streetName,
        repair.arrondissement,
        JSON.stringify(repair.coordinates),
        repair.previousNames,
        repair.previousArrondissement,
      ],
    );
  await client.query(
    "INSERT INTO app_settings(key,value_text) VALUES('parici_daily_geography_revision',$1) ON CONFLICT(key) DO UPDATE SET value_text=EXCLUDED.value_text,updated_at=NOW()",
    [revision],
  );
}
module.exports = { applyDailyGeographyRepairs, revision };
