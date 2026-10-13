"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
function photoManifest() {
  const file = path.resolve(
    __dirname,
    "../../../data/collect_photos_paris.json",
  );
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
}
function photoRevision(manifest = photoManifest()) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify(
        Object.entries(manifest)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, value]) => [key, value.image]),
      ),
    )
    .update("parici-logo-fallback-v1")
    .digest("hex");
}
async function applyPhotographs(client) {
  const manifest = photoManifest(),
    entries = Object.entries(manifest);
  if (!entries.length) return;
  const revision = photoRevision(manifest);
  const marker = await client.query(
    "SELECT value_text FROM app_settings WHERE key='parici_collect_photo_revision'",
  );
  if (marker.rows[0]?.value_text === revision) return;
  const photos = entries.map(([key, entry]) => ({
    family: key.slice(0, key.indexOf(":")),
    source_entity_id: key.slice(key.indexOf(":") + 1),
    image: entry.image,
  }));
  await client.query(
    `UPDATE cards c SET image_reference=p.image
   FROM jsonb_to_recordset($1::jsonb) AS p(family text,source_entity_id text,image text)
   WHERE c.family=p.family AND c.source_entity_id=p.source_entity_id
   AND c.image_override IS NULL AND c.image_reference IS DISTINCT FROM p.image`,
    [JSON.stringify(photos)],
  );
  const catalog = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../../../data/collect_paris_catalog.json"), "utf8"),
  );
  const withoutPhoto = catalog.records
    .filter((card) => card.illustration.kind !== "photograph")
    .map(({ family, source_entity_id }) => ({ family, source_entity_id }));
  await client.query(
    `UPDATE cards c SET image_reference='/apple-touch-icon.png'
   FROM jsonb_to_recordset($1::jsonb) AS p(family text,source_entity_id text)
   WHERE c.family=p.family AND c.source_entity_id=p.source_entity_id
   AND c.image_override IS NULL AND c.image_reference IS DISTINCT FROM '/apple-touch-icon.png'`,
    [JSON.stringify(withoutPhoto)],
  );
  await client.query(
    "INSERT INTO app_settings(key,value_text) VALUES('parici_collect_photo_revision',$1) ON CONFLICT(key) DO UPDATE SET value_text=EXCLUDED.value_text",
    [revision],
  );
}
module.exports = { applyPhotographs, photoManifest, photoRevision };
