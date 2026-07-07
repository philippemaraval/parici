#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const MIN_LIGHT_SEGMENTS = 5000;
const MIN_UNIQUE_STREETS = 2000;

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return { raw, value: JSON.parse(raw) };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function isFiniteCoordinatePair(value) {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    Number.isFinite(Number(value[0])) &&
    Number.isFinite(Number(value[1]))
  );
}

function validateOsmOutputs(projectRoot = path.resolve(__dirname, "..")) {
  const files = {
    light: path.join(projectRoot, "data", "paris_rues_light.geojson"),
    enriched: path.join(projectRoot, "data", "paris_rues_enrichi.geojson"),
    backendLight: path.join(projectRoot, "backend", "data", "paris_rues_light.geojson"),
    arrondissements: path.join(projectRoot, "data", "paris_arrondissements.geojson"),
    backendArrondissements: path.join(projectRoot, "backend", "data", "paris_arrondissements.geojson"),
    monuments: path.join(projectRoot, "data", "paris_monuments.geojson"),
    backendMonuments: path.join(projectRoot, "backend", "data", "paris_monuments.geojson"),
    index: path.join(projectRoot, "backend", "data", "streets_index.json"),
    metadata: path.join(projectRoot, "data", "map_sync_meta.json"),
  };

  Object.values(files).forEach((filePath) => {
    assert(fs.existsSync(filePath), `Fichier OSM manquant : ${path.relative(projectRoot, filePath)}`);
  });

  const light = readJson(files.light);
  const enriched = readJson(files.enriched);
  const backendLight = readJson(files.backendLight);
  const arrondissements = readJson(files.arrondissements);
  const backendArrondissements = readJson(files.backendArrondissements);
  const monuments = readJson(files.monuments);
  const backendMonuments = readJson(files.backendMonuments);
  const index = readJson(files.index);
  const metadata = readJson(files.metadata);

  assert(light.value?.type === "FeatureCollection", "Le GeoJSON léger est invalide.");
  assert(enriched.value?.type === "FeatureCollection", "Le GeoJSON enrichi est invalide.");
  assert(backendLight.value?.type === "FeatureCollection", "La copie backend est invalide.");
  assert(arrondissements.value?.type === "FeatureCollection", "Le GeoJSON des quartiers est invalide.");
  assert(backendArrondissements.value?.type === "FeatureCollection", "La copie backend des quartiers est invalide.");
  assert(monuments.value?.type === "FeatureCollection", "Le GeoJSON des monuments est invalide.");
  assert(backendMonuments.value?.type === "FeatureCollection", "La copie backend des monuments est invalide.");
  assert(Array.isArray(index.value), "L’index des rues Daily doit être un tableau.");

  const lightCount = light.value.features?.length || 0;
  const enrichedCount = enriched.value.features?.length || 0;
  const uniqueStreetCount = index.value.length;
  assert(lightCount >= MIN_LIGHT_SEGMENTS, `Trop peu de segments OSM conservés : ${lightCount}.`);
  assert(enrichedCount >= lightCount, "Le jeu enrichi contient moins de segments que le jeu léger.");
  assert(
    uniqueStreetCount >= MIN_UNIQUE_STREETS,
    `Trop peu de rues uniques dans l’index Daily : ${uniqueStreetCount}.`,
  );
  assert(
    sha256(light.raw) === sha256(backendLight.raw),
    "La copie backend du GeoJSON léger diffère de la copie frontend.",
  );
  assert(
    sha256(arrondissements.raw) === sha256(backendArrondissements.raw),
    "La copie backend des quartiers diffère de la copie frontend.",
  );
  assert(
    sha256(monuments.raw) === sha256(backendMonuments.raw),
    "La copie backend des monuments diffère de la copie frontend.",
  );

  light.value.features.forEach((feature, indexPosition) => {
    assert(feature?.type === "Feature", `Segment léger #${indexPosition + 1} invalide.`);
    assert(feature?.geometry, `Géométrie absente pour le segment léger #${indexPosition + 1}.`);
    assert(
      String(feature?.properties?.name || "").trim(),
      `Nom absent pour le segment léger #${indexPosition + 1}.`,
    );
  });

  const normalizedNames = new Set();
  index.value.forEach((entry, indexPosition) => {
    const name = String(entry?.name || "").trim();
    const normalizedName = name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    assert(name, `Nom absent dans l’index Daily #${indexPosition + 1}.`);
    assert(
      isFiniteCoordinatePair(entry?.centroid),
      `Centroïde invalide dans l’index Daily pour « ${name} ».`,
    );
    assert(!normalizedNames.has(normalizedName), `Doublon dans l’index Daily : « ${name} ».`);
    normalizedNames.add(normalizedName);
  });

  assert(
    metadata.value?.generatedBy === "scripts/sync_osm.js",
    "Métadonnées OSM : générateur inattendu.",
  );
  assert(
    Date.parse(metadata.value?.lastSyncedAt || "") > 0,
    "Métadonnées OSM : date de synchronisation invalide.",
  );
  assert(
    Number(metadata.value?.keptMapSegments) === lightCount,
    "Métadonnées OSM incohérentes avec le nombre de segments légers.",
  );
  assert(
    Number(metadata.value?.uniqueStreets) === uniqueStreetCount,
    "Métadonnées OSM incohérentes avec l’index Daily.",
  );

  return {
    lightSegments: lightCount,
    enrichedSegments: enrichedCount,
    uniqueStreets: uniqueStreetCount,
  };
}

if (require.main === module) {
  try {
    const result = validateOsmOutputs();
    console.log(
      `Validation OSM réussie : ${result.lightSegments} segments de carte, ` +
        `${result.enrichedSegments} segments enrichis, ${result.uniqueStreets} rues uniques.`,
    );
  } catch (error) {
    console.error(`Validation OSM échouée : ${error.message}`);
    process.exit(1);
  }
}

module.exports = { validateOsmOutputs };
