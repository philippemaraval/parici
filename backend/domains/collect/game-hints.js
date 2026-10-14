"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { buildStreetEntities } = require("./street-entities");
const root = path.resolve(__dirname, "../../..");
let locations;
const { compactMap, prepareStreetMap } = require("./map-data");
const {
  computeFeatureCollectionMidpoint,
} = require("../../../src/geometry-center.cjs");
const { shouldKeepStreetForGame } = require("../../../street_filter");
function catalogLocations() {
  if (locations) return locations;
  const read = (file) =>
    JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
  const index = read("backend/data/streets_index.json").filter((entry) =>
    shouldKeepStreetForGame({ name: entry.name, osm_name: entry.osmName }),
  );
  const streetMap = prepareStreetMap(
    read("backend/data/paris_rues_light.geojson"),
    index,
  );
  locations = new Map();
  for (const [family, data, key] of [
    ["street", streetMap, "collect_entity_id"],
    ["district", read("backend/data/paris_arrondissements.geojson"), "nom_qua"],
    ["monument", read("backend/data/paris_monuments.geojson"), "name"],
    ["bus", read("data/paris_transit_lines.geojson"), "name"],
  ]) {
    const groups = new Map();
    // Use the same rounded vertices sent to the browser, and all parts of each entity.
    for (const feature of compactMap(data, family).features) {
      const id = feature.properties[key];
      if (!id) continue;
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(feature);
    }
    for (const [id, features] of groups)
      locations.set(
        family + ":" + id,
        computeFeatureCollectionMidpoint(features),
      );
  }
  for (const entity of buildStreetEntities(index).entities)
    for (const source of entity.sources)
      locations.set(
        "street:" + source.name,
        locations.get("street:" + entity.id),
      );
  return locations;
}
function placementFeedback(from, to) {
  if (!from || !to) return null;
  const rad = Math.PI / 180;
  const lat1 = from[1] * rad,
    lat2 = to[1] * rad,
    delta = (to[0] - from[0]) * rad;
  const a =
    Math.sin((lat2 - lat1) / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(delta / 2) ** 2;
  const distance =
    6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  const bearing =
    (Math.atan2(
      Math.sin(delta) * Math.cos(lat2),
      Math.cos(lat1) * Math.sin(lat2) -
        Math.sin(lat1) * Math.cos(lat2) * Math.cos(delta),
    ) /
      rad +
      360) %
    360;
  const directions = [
    "nord",
    "nord-est",
    "est",
    "sud-est",
    "sud",
    "sud-ouest",
    "ouest",
    "nord-ouest",
  ];
  return {
    distanceMetres: Math.round(distance / 10) * 10,
    direction: directions[Math.round(bearing / 45) % 8],
  };
}
function guessFeedback(family, answer, target) {
  const map = catalogLocations();
  return placementFeedback(
    map.get(family + ":" + answer),
    map.get(family + ":" + target),
  );
}
function attemptsForRarity(rarity) {
  return { 1: 1, 2: 2, 3: 3, 4: 3, 5: 1 }[Number(rarity)] || 1;
}
function placementAttemptLimit(family, limit, name = "") {
  const attempts = Number(limit) || 1;
  const namesDistrict =
    family === "street" && /\s+-\s+Quartier(?:\s|$)/iu.test(String(name));
  return attempts === 3 && (family === "monument" || namesDistrict)
    ? 2
    : attempts;
}
module.exports = {
  attemptsForRarity,
  placementAttemptLimit,
  guessFeedback,
  placementFeedback,
};
