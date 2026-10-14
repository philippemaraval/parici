"use strict";
const catalog = require("../../../data/collect_paris_catalog.json");
const records = new Map(
  catalog.records.map((r) => [r.family + ":" + r.source_entity_id, r]),
);
function cardDetails(family, id) {
  const record = records.get(family + ":" + id);
  if (!record)
    return {
      album_slugs: [],
      location_label: "Localisation à préciser",
      short_description: "Contenu parisien à compléter.",
      description_full: "Contenu parisien à compléter.",
      detailed_description: "Contenu parisien à compléter.",
      description_source: null,
    };
  // Descriptions are public metadata, the question bank and catalog seed are not.
  return Object.fromEntries(
    [
      "album_slugs",
      "location_label",
      "short_description",
      "description_full",
      "detailed_description",
      "description_source",
      "district",
      "districts",
      "arrondissement",
    ].map((key) => [key, record[key]]),
  );
}
module.exports = { cardDetails, albumDefinitions: () => catalog.albums };
