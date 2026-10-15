"use strict";
const fs = require("node:fs"),
  path = require("node:path");
async function applyParisCollect(client) {
  const marker = await client.query(
    "SELECT value_text FROM app_settings WHERE key='parici_collect_schema'",
  );
  if (marker.rows[0]?.value_text === "20261013-1") return;
  await client.query(
    fs.readFileSync(
      path.resolve(__dirname, "../../../migrations/20261013_collect_paris.sql"),
      "utf8",
    ),
  );
  const catalog = require("../../../data/collect_paris_catalog.json");
  await client.query(
    `INSERT INTO cards(family,source_entity_id,collection_number,name,image_reference,base_rarity,current_rarity,fragments_enabled,fragments_required)
 SELECT family,source_entity_id,collection_number,name,image_reference,base_rarity,base_rarity,fragments_required>0,fragments_required
 FROM jsonb_to_recordset($1::jsonb) AS r(family text,source_entity_id text,collection_number integer,name text,image_reference text,base_rarity smallint,fragments_required integer)
 ON CONFLICT(family,source_entity_id) DO NOTHING`,
    [JSON.stringify(catalog.records)],
  );
  await client.query(
    `INSERT INTO albums(slug,name) SELECT slug,name FROM jsonb_to_recordset($1::jsonb) AS a(slug text,name text) ON CONFLICT(slug) DO NOTHING`,
    [JSON.stringify(catalog.albums)],
  );
  await client.query(
    `INSERT INTO album_cards(album_id,card_id) SELECT a.id,c.id FROM jsonb_to_recordset($1::jsonb) AS r(family text,source_entity_id text,album_slugs jsonb) JOIN cards c ON c.family=r.family AND c.source_entity_id=r.source_entity_id CROSS JOIN LATERAL jsonb_array_elements_text(r.album_slugs) slug JOIN albums a ON a.slug=slug.value ON CONFLICT DO NOTHING`,
    [JSON.stringify(catalog.records)],
  );
  const questions = catalog.records.flatMap((r) =>
    r.questions.map((q, position) => ({
      ...q,
      position,
      family: r.family,
      source_entity_id: r.source_entity_id,
    })),
  );
  await client.query(
    `INSERT INTO collect_questions(id,card_id,position,theme,text,answers,correct_index,explanation,sources)
 SELECT q.id,c.id,q.position,q.theme,q.text,q.answers,q.correct_index,q.explanation,q.sources FROM jsonb_to_recordset($1::jsonb) AS q(id uuid,family text,source_entity_id text,position integer,theme text,text text,answers jsonb,correct_index integer,explanation text,sources jsonb) JOIN cards c ON c.family=q.family AND c.source_entity_id=q.source_entity_id ON CONFLICT DO NOTHING`,
    [JSON.stringify(questions)],
  );
  await client.query(
    `INSERT INTO card_answer_aliases(card_id,answer_entity_id,answer_context) SELECT c.id,r.answer,r.context FROM jsonb_to_recordset($1::jsonb) AS r(entity text,answer text,context text) JOIN cards c ON c.family='street' AND c.source_entity_id=r.entity ON CONFLICT DO NOTHING`,
    [
      JSON.stringify(
        require("./street-entities")
          .buildStreetEntities(require("../../data/streets_index.json"))
          .entities.flatMap((e) =>
            e.sources.map((s) => ({
              entity: e.id,
              answer: s.name,
              context: s.quartier || "",
            })),
          ),
      ),
    ],
  );
  await client.query(
    `INSERT INTO app_settings(key,value_text) VALUES('collect_v2_schema','20261008-3'),('parici_collect_schema','20261013-1') ON CONFLICT(key) DO UPDATE SET value_text=EXCLUDED.value_text;`,
  );
}
module.exports = { applyParisCollect };
