"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  zlib = require("node:zlib");
const { prepareStreetMap, compactMap } = require("./map-data");
let cache;
function geometryCoverage(index) {
  const root = path.resolve(__dirname, "../../..");
  const files = {
    street: "backend/data/paris_rues_light.geojson",
    district: "backend/data/paris_arrondissements.geojson",
    monument: "backend/data/paris_monuments.geojson",
    bus: "data/paris_transit_lines.geojson",
  };
  const stamp = JSON.stringify(
    Object.values(files).map((f) => fs.statSync(path.join(root, f)).mtimeMs),
  );
  if (cache?.index === index && cache.stamp === stamp) return cache.entries;
  const entries = Object.entries(files).map(([family, file]) => {
    const data = JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
    if (family === "street") prepareStreetMap(data, index);
    const compact = compactMap(data, family),
      body = Buffer.from(JSON.stringify(compact));
    const ids = new Set(
      compact.features
        .filter((f) => f.geometry)
        .map((f) =>
          family === "street"
            ? f.properties.collect_entity_id
            : family === "district"
              ? f.properties.nom_qua
              : f.properties.name,
        ),
    );
    return {
      family,
      status: "loaded",
      features: compact.features.length,
      bytes: body.length,
      compressedBytes: zlib.gzipSync(body).length,
      coverage: compact.collectCoverage || null,
      ids,
    };
  });
  cache = { index, stamp, entries };
  return entries;
}
async function geometryHealth(db, index) {
  const active = (
    await db.pool.query(
      "SELECT family,source_entity_id FROM cards WHERE status='active' AND catalog_present AND NOT EXISTS(SELECT 1 FROM collect_card_merges WHERE source_card_id=cards.id)",
    )
  ).rows;
  return geometryCoverage(index).map(({ ids, ...entry }) => ({
    ...entry,
    missing: active.filter(
      (c) => c.family === entry.family && !ids.has(c.source_entity_id),
    ).length,
  }));
}
module.exports = { geometryHealth, geometryCoverage };
