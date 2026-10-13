"use strict";
const catalog = require("../../../data/collect_paris_catalog.json");
const VERSION = "20261013-2";
async function applyCatalogCorrections(client) {
  const marker = await client.query(
    "SELECT value_text FROM app_settings WHERE key='parici_collect_catalog_revision'",
  );
  if (marker.rows[0]?.value_text === VERSION) return;
  // Do not overwrite a manual rarity or a rarity evaluated from actual games.
  await client.query(
    `UPDATE cards c SET
    base_rarity=COALESCE(c.base_rarity_override,r.base_rarity),
    current_rarity=CASE WHEN c.rarity_override IS NULL AND c.rarity_evaluated_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM card_rarity_history h WHERE h.card_id=c.id)
      THEN COALESCE(c.base_rarity_override,r.base_rarity) ELSE c.current_rarity END
    FROM jsonb_to_recordset($1::jsonb) AS r(family text,source_entity_id text,base_rarity smallint)
    WHERE c.family=r.family AND c.source_entity_id=r.source_entity_id`,
    [JSON.stringify(catalog.records)],
  );
  const newExplorer = new Set(
    require("../../../data/explorer_paris.json")
      .filter((r) => r.seed_key.startsWith("paris-rive-gauche-"))
      .map((r) => r.street_name_clean),
  );
  const added = catalog.records.filter(
    (r) =>
      r.fragments_required &&
      (r.family === "monument" ||
        (r.family === "street" && newExplorer.has(r.name))),
  );
  await client.query(
    `UPDATE cards c SET fragments_enabled=TRUE,fragments_required=r.fragments_required
    FROM jsonb_to_recordset($1::jsonb) AS r(family text,source_entity_id text,fragments_required integer)
    WHERE c.family=r.family AND c.source_entity_id=r.source_entity_id AND NOT c.fragments_enabled
    AND NOT EXISTS(SELECT 1 FROM collect_content_corrections e WHERE e.card_id=c.id)`,
    [JSON.stringify(added)],
  );
  const questions = added.flatMap((r) =>
    r.questions.map((q, position) => ({
      ...q,
      position,
      family: r.family,
      source_entity_id: r.source_entity_id,
    })),
  );
  await client.query(
    `INSERT INTO collect_questions(id,card_id,position,theme,text,answers,correct_index,explanation,sources)
    SELECT q.id,c.id,q.position,q.theme,q.text,q.answers,q.correct_index,q.explanation,q.sources
    FROM jsonb_to_recordset($1::jsonb) AS q(id uuid,family text,source_entity_id text,position integer,theme text,text text,answers jsonb,correct_index integer,explanation text,sources jsonb)
    JOIN cards c ON c.family=q.family AND c.source_entity_id=q.source_entity_id ON CONFLICT(id) DO NOTHING`,
    [JSON.stringify(questions)],
  );
  // Only these two automatically managed memberships were broken. Other albums,
  // including players' personal albums, are untouched.
  await client.query(`DELETE FROM album_cards ac USING albums a,cards c
    WHERE ac.album_id=a.id AND ac.card_id=c.id AND a.slug IN ('famous-streets','main-streets') AND c.family='street'`);
  await client.query(
    `INSERT INTO album_cards(album_id,card_id)
    SELECT a.id,c.id FROM jsonb_to_recordset($1::jsonb) AS r(family text,source_entity_id text,album_slugs jsonb)
    JOIN cards c ON c.family=r.family AND c.source_entity_id=r.source_entity_id
    CROSS JOIN LATERAL jsonb_array_elements_text(r.album_slugs) slug
    JOIN albums a ON a.slug=slug.value WHERE a.slug IN ('famous-streets','main-streets') ON CONFLICT DO NOTHING`,
    [JSON.stringify(catalog.records)],
  );
  // A future unresolved seed target can be repaired; never change a started Daily.
  await client.query(`UPDATE daily_targets t SET street_name='Rue de Sablonville',arrondissement='Quartier des Ternes',
    coordinates_json='[2.28097,48.88062]',geometry_json=NULL
    WHERE date='2027-01-30' AND date>to_char(NOW() AT TIME ZONE 'Europe/Paris','YYYY-MM-DD')
    AND street_name='Tunnel Grand-Maillot' AND image_url IS NULL
    AND NOT EXISTS(SELECT 1 FROM daily_user_attempts d WHERE d.date=t.date)`);
  await client.query(
    "INSERT INTO app_settings(key,value_text) VALUES('parici_collect_catalog_revision',$1) ON CONFLICT(key) DO UPDATE SET value_text=EXCLUDED.value_text",
    [VERSION],
  );
}
module.exports = { applyCatalogCorrections, VERSION };
