"use strict";
const { getDistanceMeters } = require("../../../src/geometry-center.cjs");
// Remove unused feature metadata and sub-metre coordinate precision. The
// selectable paths remain the observed source geometries, with every vertex.
function compactMap(data, family) {
  const keys =
    family === "street"
      ? [
          "name",
          "osm_name",
          "quartier",
          "collect_entity_id",
          "collect_geometry_source",
        ]
      : family === "district"
        ? ["nom_qua", "name"]
        : family === "bus"
          ? ["name", "color", "ref", "from", "to"]
          : ["name"];
  function coordinates(value) {
    if (!Array.isArray(value)) return value;
    if (typeof value[0] === "number")
      return value.slice(0, 2).map((v) => Math.round(v * 1e5) / 1e5);
    return value.map(coordinates);
  }
  return {
    type: "FeatureCollection",
    ...(data.collectCoverage ? { collectCoverage: data.collectCoverage } : {}),
    features: (data.features || []).map((f) => ({
      type: "Feature",
      properties: Object.fromEntries(
        keys
          .filter((k) => f.properties?.[k] !== undefined)
          .map((k) => [k, f.properties[k]]),
      ),
      geometry: {
        type: f.geometry.type,
        coordinates: coordinates(f.geometry.coordinates),
      },
    })),
  };
}

// Shared preparation: hints and the selectable map must use identical street groups.
function prepareStreetMap(data, streetIndex) {
  const resolveStreetIndexEntry = streetResolver(streetIndex);
  const { sourceToEntity } =
    require("./street-entities").buildStreetEntities(streetIndex);
  for (const feature of data.features || []) {
    let x = 0;
    let y = 0;
    let count = 0;
    function visit(coordinates) {
      if (!Array.isArray(coordinates)) return;
      if (typeof coordinates[0] === "number") {
        x += coordinates[0];
        y += coordinates[1];
        count += 1;
      } else coordinates.forEach(visit);
    }
    visit(feature.geometry?.coordinates);
    const centroid = count
      ? [
          Math.round((x / count) * 1e5) / 1e5,
          Math.round((y / count) * 1e5) / 1e5,
        ]
      : null;
    const source =
      resolveStreetIndexEntry(
        feature.properties?.name,
        feature.properties?.quartier,
        centroid,
      ) ||
      resolveStreetIndexEntry(
        feature.properties?.osm_name,
        feature.properties?.quartier,
        centroid,
      );
    const entity = source
      ? sourceToEntity.get(String(source.name).trim())
      : null;
    feature.properties = {
      ...feature.properties,
      collect_entity_id: entity?.id || source?.name || null,
    };
  }
  // Some index entries have been renamed since the geometry snapshot. Keep their
  // observed index coordinates selectable without inventing a street outline.
  const mapped = new Set(
    data.features
      .map((feature) => feature.properties?.collect_entity_id)
      .filter(Boolean),
  );
  const streetsWithOutlines = mapped.size;
  let referencePoints = 0;
  for (const source of streetIndex) {
    const entityId =
      sourceToEntity.get(String(source.name).trim())?.id || source.name;
    if (
      mapped.has(entityId) ||
      !Array.isArray(source.centroid) ||
      source.centroid.length !== 2 ||
      !source.centroid.every(Number.isFinite)
    )
      continue;
    data.features.push({
      type: "Feature",
      properties: {
        name: source.name,
        quartier: source.quartier,
        collect_entity_id: entityId,
        collect_geometry_source: "street_index_centroid",
      },
      geometry: { type: "Point", coordinates: source.centroid },
    });
    mapped.add(entityId);
    referencePoints += 1;
  }
  data.collectCoverage = {
    streets: streetIndex.length,
    streetsWithOutlines,
    streetsSelectable: mapped.size,
    referencePoints,
  };
  return data;
}

function streetResolver(index) {
  const normalize = (value) =>
    String(value || "")
      .trim()
      .toLowerCase();
  const exact = new Map();
  const aliases = new Map();
  for (const entry of index) {
    if (!exact.has(normalize(entry.name)))
      exact.set(normalize(entry.name), entry);
    const key = normalize(entry.osmName || entry.name);
    if (!aliases.has(key)) aliases.set(key, []);
    aliases.get(key).push(entry);
  }
  return (name, quartier, coordinates) => {
    const key = normalize(name);
    if (!key) return null;
    if (exact.has(key)) return exact.get(key);
    const matches = aliases.get(key) || [];
    const local = normalize(quartier)
      ? matches.filter((e) => normalize(e.quartier) === normalize(quartier))
      : [];
    const candidates = local.length ? local : matches;
    if (Array.isArray(coordinates) && candidates.length > 1) {
      const distance = (entry) =>
        getDistanceMeters(
          entry.centroid[1],
          entry.centroid[0],
          coordinates[1],
          coordinates[0],
        );
      return (
        candidates
          .filter((e) => Array.isArray(e.centroid))
          .sort((a, b) => distance(a) - distance(b))[0] || null
      );
    }
    return candidates.length === 1 ? candidates[0] : null;
  };
}
module.exports = { compactMap, prepareStreetMap };
