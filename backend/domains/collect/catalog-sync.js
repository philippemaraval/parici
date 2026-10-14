"use strict";
const crypto = require("node:crypto");
const catalog = require("../../../data/collect_paris_catalog.json");
const VERSION = "parici-catalog-sync-v1";
function catalogRevision(value = catalog) {
  return crypto
    .createHash("sha256")
    .update(VERSION)
    .update(JSON.stringify(value))
    .digest("hex");
}
async function syncCatalog(client, value = catalog) {
  const revision = catalogRevision(value);
  const marker = (
    await client.query(
      "SELECT value_text FROM app_settings WHERE key='parici_collect_sync_revision'",
    )
  ).rows[0];
  let snapshot = {};
  try {
    snapshot = JSON.parse(marker?.value_text || "{}");
  } catch {}
  if (snapshot.revision === revision) return;
  const records = value.records.map((c) => ({ ...c, questions: undefined }));
  const previous = Array.isArray(snapshot.identities)
    ? snapshot.identities
    : [];
  // Removed source identities leave circulation intact; only future draws stop.
  await client.query(
    `UPDATE cards c SET catalog_present=FALSE
    FROM jsonb_to_recordset($1::jsonb) AS p(family text,source_entity_id text)
    WHERE c.family=p.family AND c.source_entity_id=p.source_entity_id AND NOT EXISTS(
      SELECT 1 FROM jsonb_to_recordset($2::jsonb) AS r(family text,source_entity_id text)
      WHERE r.family=c.family AND r.source_entity_id=c.source_entity_id)`,
    [JSON.stringify(previous), JSON.stringify(records)],
  );
  await client.query(
    `INSERT INTO cards(family,source_entity_id,collection_number,name,image_reference,base_rarity,current_rarity,fragments_enabled,fragments_required,catalog_present)
    SELECT family,source_entity_id,collection_number,name,image_reference,base_rarity,base_rarity,fragments_required>0,fragments_required,TRUE
    FROM jsonb_to_recordset($1::jsonb) AS r(family text,source_entity_id text,collection_number integer,name text,image_reference text,base_rarity smallint,fragments_required integer)
    ON CONFLICT(family,source_entity_id) DO UPDATE SET name=EXCLUDED.name,catalog_present=TRUE`,
    [JSON.stringify(records)],
  );
  // Numbering, manual rarities, archives, fragments, copies and editorial overrides are never reset.
  await client.query(
    `INSERT INTO albums(slug,name) SELECT slug,name FROM jsonb_to_recordset($1::jsonb) AS a(slug text,name text)
    ON CONFLICT(slug) DO NOTHING`,
    [JSON.stringify(value.albums)],
  );
  const managedSlugs = [
    ...new Set([
      ...(snapshot.albums || []),
      ...value.albums.map((a) => a.slug),
    ]),
  ];
  await client.query(
    `DELETE FROM album_cards ac USING albums a,cards c WHERE ac.album_id=a.id AND ac.card_id=c.id
    AND a.slug=ANY($1::text[]) AND EXISTS(SELECT 1 FROM jsonb_to_recordset($2::jsonb) AS r(family text,source_entity_id text)
      WHERE r.family=c.family AND r.source_entity_id=c.source_entity_id)`,
    [managedSlugs, JSON.stringify([...previous, ...records])],
  );
  await client.query(
    `INSERT INTO album_cards(album_id,card_id) SELECT a.id,c.id
    FROM jsonb_to_recordset($1::jsonb) AS r(family text,source_entity_id text,album_slugs jsonb)
    JOIN cards c ON c.family=r.family AND c.source_entity_id=r.source_entity_id
    CROSS JOIN LATERAL jsonb_array_elements_text(r.album_slugs) slug JOIN albums a ON a.slug=slug.value ON CONFLICT DO NOTHING`,
    [JSON.stringify(records)],
  );
  const entities = require("./street-entities").buildStreetEntities(
    require("../../data/streets_index.json"),
  ).entities;
  const aliases = entities.flatMap((entity) =>
    entity.sources.map((source) => ({
      entity: entity.id,
      answer: source.name,
      context: source.quartier || "",
    })),
  );
  await client.query(
    `INSERT INTO card_answer_aliases(card_id,answer_entity_id,answer_context)
    SELECT c.id,r.answer,r.context FROM jsonb_to_recordset($1::jsonb) AS r(entity text,answer text,context text)
    JOIN cards c ON c.family='street' AND c.source_entity_id=r.entity ON CONFLICT DO NOTHING`,
    [JSON.stringify(aliases)],
  );
  const questions = value.records.flatMap((r) =>
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
  await client.query(
    "INSERT INTO app_settings(key,value_text) VALUES('parici_collect_sync_revision',$1) ON CONFLICT(key) DO UPDATE SET value_text=EXCLUDED.value_text,updated_at=NOW()",
    [
      JSON.stringify({
        revision,
        identities: records.map(({ family, source_entity_id }) => ({
          family,
          source_entity_id,
        })),
        albums: value.albums.map((a) => a.slug),
      }),
    ],
  );
}
module.exports = { syncCatalog, catalogRevision };
