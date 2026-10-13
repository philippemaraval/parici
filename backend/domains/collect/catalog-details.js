"use strict";
const catalog = require("../../../data/collect_paris_catalog.json");
const records = new Map(
  catalog.records.map((r) => [r.family + ":" + r.source_entity_id, r]),
);
function cardDetails(family, id) {
  return (
    records.get(family + ":" + id) || {
      album_slugs: [],
      location_label: "Localisation à préciser",
      short_description: "Contenu parisien à compléter.",
      description_full: "Contenu parisien à compléter.",
      detailed_description: "Contenu parisien à compléter.",
      description_source: null,
    }
  );
}
module.exports = { cardDetails, albumDefinitions: () => catalog.albums };
