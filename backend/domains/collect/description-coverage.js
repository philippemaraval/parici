"use strict";
function descriptionCoverage(catalog, descriptions) {
  const entries = catalog.records
    .map((card) => descriptions[card.family + ":" + card.source_entity_id])
    .filter(Boolean);
  const geographicDescriptions = entries.filter(
    (entry) => entry.description_kind === "geographic",
  ).length;
  return {
    documentedDescriptions: entries.length,
    heritageDescriptions: entries.length - geographicDescriptions,
    geographicDescriptions,
  };
}
module.exports = { descriptionCoverage };
