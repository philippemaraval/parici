"use strict";

function normalize(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("fr")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’`´]/g, "'")
    .replace(/[-‐‑‒–—]/g, "-")
    .replace(/\s+/g, " ");
}

function distanceKm(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return Infinity;
  const radians = Math.PI / 180;
  const latitude = (right[1] - left[1]) * radians;
  const longitude = (right[0] - left[0]) * radians;
  const a =
    Math.sin(latitude / 2) ** 2 +
    Math.cos(left[1] * radians) *
      Math.cos(right[1] * radians) *
      Math.sin(longitude / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

function isLengthSegment(name) {
  return /\s-\s.*\s-\s\d+\s*m$/i.test(String(name || "").trim());
}

function shouldMerge(entries) {
  const names = [
    ...new Set(
      entries.map((entry) => String(entry.name || "").trim()).filter(Boolean),
    ),
  ];
  if (names.length < 2) return false;
  let maximumDistance = 0;
  let duplicateLocation = false;
  for (const left of entries) {
    for (const right of entries) {
      const distance = distanceKm(left.centroid, right.centroid);
      maximumDistance = Math.max(maximumDistance, distance);
      if (left !== right && distance < 0.03) duplicateLocation = true;
    }
  }
  return (
    maximumDistance <= 2 && (names.some(isLengthSegment) || duplicateLocation)
  );
}

function buildStreetEntities(streets) {
  const byOsmName = new Map();
  for (const street of streets) {
    const key = normalize(street.osmName || street.name);
    if (!byOsmName.has(key)) byOsmName.set(key, []);
    byOsmName.get(key).push(street);
  }
  const entities = [];
  const sourceToEntity = new Map();
  for (const entries of byOsmName.values()) {
    const groups = shouldMerge(entries)
      ? [entries]
      : entries.map((entry) => [entry]);
    for (const sources of groups) {
      const preferred =
        sources.find(
          (entry) => normalize(entry.name) === normalize(entry.osmName),
        ) ||
        [...sources].sort((a, b) =>
          String(a.name).localeCompare(String(b.name), "fr", { numeric: true }),
        )[0];
      const entity = {
        id: String(preferred.name).trim(),
        name: shouldMerge(sources)
          ? String(preferred.osmName || preferred.name).trim()
          : String(preferred.name).trim(),
        sources,
        merged: sources.length > 1,
      };
      entities.push(entity);
      for (const source of sources)
        sourceToEntity.set(String(source.name).trim(), entity);
    }
  }
  return { entities, sourceToEntity };
}

module.exports = { buildStreetEntities, isLengthSegment, normalize };
