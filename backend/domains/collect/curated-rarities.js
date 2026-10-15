"use strict";
const crypto = require("node:crypto");
const overrides = require("../../../data/collect_curated_rarity_overrides_paris.json");
const records = Object.entries(overrides)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([key, base_rarity]) => {
    const separator = key.indexOf(":");
    return {
      family: key.slice(0, separator),
      source_entity_id: key.slice(separator + 1),
      base_rarity,
    };
  });
const revision = crypto
  .createHash("sha256")
  .update("legendary-schema-v1")
  .update(JSON.stringify(records))
  .digest("hex");
async function applyCuratedRarities(client) {
  const marker = await client.query(
    "SELECT value_text FROM app_settings WHERE key='parici_curated_rarity_revision'",
  );
  if (marker.rows[0]?.value_text === revision) return;
  await client.query(
    require("node:fs").readFileSync(
      require("node:path").resolve(
        __dirname,
        "../../../migrations/20261015_collect_legendary_rarities.sql",
      ),
      "utf8",
    ),
  );
  await client.query(
    `UPDATE cards c SET
    base_rarity=COALESCE(c.base_rarity_override,r.base_rarity),
    current_rarity=CASE WHEN c.rarity_override IS NULL AND c.rarity_evaluated_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM card_rarity_history h WHERE h.card_id=c.id)
      THEN COALESCE(c.base_rarity_override,r.base_rarity) ELSE c.current_rarity END
    FROM jsonb_to_recordset($1::jsonb) AS r(family text,source_entity_id text,base_rarity smallint)
    WHERE c.family=r.family AND c.source_entity_id=r.source_entity_id`,
    [JSON.stringify(records)],
  );
  await client.query(
    "INSERT INTO app_settings(key,value_text) VALUES('parici_curated_rarity_revision',$1) ON CONFLICT(key) DO UPDATE SET value_text=EXCLUDED.value_text",
    [revision],
  );
}
module.exports = { applyCuratedRarities, revision };
