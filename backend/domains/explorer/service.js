"use strict";

const fs = require("fs");
const path = require("path");
const { toPositiveInteger } = require("./validation");

const STREET_DATA_CANDIDATES = [
  path.join(__dirname, "..", "..", "data", "paris_rues_light.geojson"),
  path.join(__dirname, "..", "..", "..", "data", "paris_rues_light.geojson"),
  path.join(__dirname, "..", "..", "data", "paris_rues_enrichi.geojson"),
  path.join(__dirname, "..", "..", "..", "data", "paris_rues_enrichi.geojson"),
];
const UPLOAD_PUBLIC_DIR = "/data/explorer_uploads";

function normalizeSearch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function loadFeatures() {
  const filePath = STREET_DATA_CANDIDATES.find(fs.existsSync);
  if (!filePath) return [];
  try {
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(payload.features) ? payload.features : [];
  } catch (error) {
    console.warn(
      "Explorer street catalog unavailable:",
      error?.message || error,
    );
    return [];
  }
}

function featureCoordinates(feature) {
  const points = [];
  const collect = (coordinates) => {
    if (!Array.isArray(coordinates)) return;
    if (
      typeof coordinates[0] === "number" &&
      typeof coordinates[1] === "number"
    ) {
      points.push(coordinates);
      return;
    }
    coordinates.forEach(collect);
  };
  collect(feature?.geometry?.coordinates);
  if (!points.length) return {};
  const sum = points.reduce(
    (accumulator, point) => ({
      lng: accumulator.lng + (Number(point[0]) || 0),
      lat: accumulator.lat + (Number(point[1]) || 0),
    }),
    { lat: 0, lng: 0 },
  );
  return {
    latitude: sum.lat / points.length,
    longitude: sum.lng / points.length,
  };
}

function searchStreets(rawQuery) {
  const query = normalizeSearch(rawQuery).slice(0, 80);
  const matches = [];
  for (const feature of loadFeatures()) {
    const properties = feature?.properties || {};
    const name =
      properties.name ||
      properties.nom ||
      properties.street_name ||
      properties.libelle ||
      "";
    if (!name || (query && !normalizeSearch(name).includes(query))) continue;
    const coordinates = featureCoordinates(feature);
    matches.push({
      way_id:
        toPositiveInteger(properties.way_id) ||
        toPositiveInteger(
          String(properties.osm_id || "").replace(/^way\//, ""),
        ) ||
        toPositiveInteger(String(properties.id || "").replace(/^way\//, "")) ||
        toPositiveInteger(feature?.id),
      street_name_clean: name,
      label: name,
      latitude: coordinates.latitude ?? null,
      longitude: coordinates.longitude ?? null,
    });
    if (matches.length >= 20) break;
  }
  return matches;
}

async function storeImage(body) {
  const image = require("../admin/images").decodeImage(body?.data_url);
  if (!image) return null;
  await require("./repository").query(
    "INSERT INTO explorer_uploaded_images(filename,mime_type,content) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
    [image.filename, image.mime, image.content],
  );
  return `${UPLOAD_PUBLIC_DIR}/${image.filename}`;
}

module.exports = { searchStreets, storeImage };
