#!/usr/bin/env node
/**
 * Synchronise les données Parici depuis OpenStreetMap.
 *
 * Génère :
 * - data/paris_rues_enrichi.geojson
 * - data/paris_rues_light.geojson
 * - data/paris_arrondissements.geojson
 * - data/paris_monuments.geojson
 * - backend/data/paris_rues_light.geojson
 * - backend/data/paris_arrondissements.geojson
 * - backend/data/paris_monuments.geojson
 * - backend/data/streets_index.json
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const osmtogeojson = require("osmtogeojson");
const {
  shouldExcludeOsmTags,
  shouldKeepStreetForGame,
} = require("../street_filter");

const PROJECT_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(PROJECT_DIR, "data");
const BACKEND_DATA_DIR = path.join(PROJECT_DIR, "backend", "data");
const OUTPUT_ENRICHI = path.join(DATA_DIR, "paris_rues_enrichi.geojson");
const OUTPUT_LIGHT = path.join(DATA_DIR, "paris_rues_light.geojson");
const OUTPUT_ARRONDISSEMENTS = path.join(DATA_DIR, "paris_arrondissements.geojson");
const OUTPUT_MONUMENTS = path.join(DATA_DIR, "paris_monuments.geojson");
const OUTPUT_SYNC_META = path.join(DATA_DIR, "map_sync_meta.json");
const BACKEND_LIGHT = path.join(BACKEND_DATA_DIR, "paris_rues_light.geojson");
const BACKEND_ARRONDISSEMENTS = path.join(BACKEND_DATA_DIR, "paris_arrondissements.geojson");
const BACKEND_MONUMENTS = path.join(BACKEND_DATA_DIR, "paris_monuments.geojson");
const STREETS_INDEX = path.join(BACKEND_DATA_DIR, "streets_index.json");
const COORD_PRECISION = 5;

const OVERPASS_URLS = Array.from(new Set([
  process.env.OVERPASS_URL,
  "https://overpass-api.de/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
].filter(Boolean)));

const STREETS_QUERY = `
[out:json][timeout:300];
area["ref:INSEE"="75056"]->.paris;
(
  nwr["highway"]["name"]["highway"!="cycleway"]["highway"!="path"]["highway"!="track"]["footway"!="sidewalk"]["conveying"!="forward"]["conveying"!="backward"]["public_transport"!="station"](area.paris);
  nwr["place"="square"]["name"]["footway"!="sidewalk"]["public_transport"!="station"](area.paris);
  nwr["area"="yes"]["name"]["highway"](area.paris);
);
out body;
>;
out skel qt;
`;

const ARRONDISSEMENTS_QUERY = `
[out:json][timeout:300];
area["ref:INSEE"="75056"]->.paris;
rel(area.paris)["boundary"="administrative"]["admin_level"="9"]["ref:INSEE"~"^751"];
out geom;
`;

const STATIC_MONUMENTS = [
  ["Tour Eiffel", 2.2945, 48.8584],
  ["Musée du Louvre", 2.3376, 48.8606],
  ["Cathédrale Notre-Dame de Paris", 2.3499, 48.8529],
  ["Arc de Triomphe", 2.295, 48.8738],
  ["Sacré-Cœur", 2.3431, 48.8867],
  ["Panthéon", 2.346, 48.8462],
  ["Opéra Garnier", 2.3316, 48.872],
  ["Hôtel de Ville", 2.3522, 48.8566],
  ["Centre Pompidou", 2.3522, 48.8606],
  ["Musée d'Orsay", 2.3266, 48.86],
  ["Invalides", 2.3126, 48.8566],
  ["Grand Palais", 2.3125, 48.8661],
  ["Petit Palais", 2.314, 48.866],
  ["Palais de Chaillot", 2.2886, 48.8629],
  ["Palais Royal", 2.3376, 48.8635],
  ["Conciergerie", 2.345, 48.8559],
  ["Sainte-Chapelle", 2.345, 48.8554],
  ["Cimetière du Père-Lachaise", 2.393, 48.8614],
  ["Tour Montparnasse", 2.3211, 48.8421],
  ["Bibliothèque nationale de France", 2.3765, 48.8337],
  ["Institut du Monde Arabe", 2.356, 48.8499],
  ["Place de la Bastille", 2.369, 48.8532],
  ["Place de la République", 2.3631, 48.8674],
  ["Place de la Nation", 2.3958, 48.8484],
  ["Canal Saint-Martin", 2.3662, 48.8722],
  ["Moulin Rouge", 2.3322, 48.8841],
  ["Galeries Lafayette", 2.3322, 48.8738],
  ["La Samaritaine", 2.3422, 48.8595],
  ["Pont Alexandre III", 2.3136, 48.8639],
  ["Pont Neuf", 2.3417, 48.8571],
  ["Pont des Arts", 2.3376, 48.8584],
  ["Pont de Bir-Hakeim", 2.2876, 48.8557],
  ["Parc des Buttes-Chaumont", 2.3828, 48.8809],
  ["Parc Monceau", 2.3097, 48.8796],
  ["Bois de Boulogne", 2.2522, 48.8635],
  ["Bois de Vincennes", 2.433, 48.8283],
];

function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(BACKEND_DATA_DIR, { recursive: true });
}

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === "https:" ? https : http;
    const req = mod.request(parsed, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "PariciParis/1.0",
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const data = Buffer.concat(chunks).toString();
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 240)}`));
          return;
        }
        resolve(data);
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function fetchOverpass(query, label) {
  const body = `data=${encodeURIComponent(query)}`;
  let lastError = null;
  for (const endpoint of OVERPASS_URLS) {
    try {
      console.log(`   ${label}: ${new URL(endpoint).host}`);
      return JSON.parse(await httpPost(endpoint, body));
    } catch (error) {
      lastError = error;
      console.warn(`   échec ${new URL(endpoint).host}: ${error.message}`);
    }
  }
  throw lastError || new Error(`Aucun endpoint Overpass disponible pour ${label}`);
}

function roundCoord(value) {
  return Number(Number(value).toFixed(COORD_PRECISION));
}

function roundGeometryCoordinates(coords) {
  if (typeof coords[0] === "number") {
    return coords.map(roundCoord);
  }
  return coords.map(roundGeometryCoordinates);
}

function getGeometryPoints(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Point") return [geometry.coordinates];
  if (geometry.type === "LineString" || geometry.type === "MultiPoint") return geometry.coordinates;
  if (geometry.type === "Polygon" || geometry.type === "MultiLineString") return geometry.coordinates.flat();
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat(2);
  return [];
}

function centroidOfGeometry(geometry) {
  const points = getGeometryPoints(geometry);
  if (!points.length) return null;
  const sum = points.reduce((acc, point) => [acc[0] + point[0], acc[1] + point[1]], [0, 0]);
  return [roundCoord(sum[0] / points.length), roundCoord(sum[1] / points.length)];
}

function pointInRing(point, ring) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point, polygonCoords) {
  if (!polygonCoords.length || !pointInRing(point, polygonCoords[0])) return false;
  return !polygonCoords.slice(1).some((hole) => pointInRing(point, hole));
}

function pointInFeature(point, feature) {
  if (feature.geometry.type === "Polygon") {
    return pointInPolygon(point, feature.geometry.coordinates);
  }
  if (feature.geometry.type === "MultiPolygon") {
    return feature.geometry.coordinates.some((polygon) => pointInPolygon(point, polygon));
  }
  return false;
}

function distanceSq(point, other) {
  const dx = point[0] - other[0];
  const dy = point[1] - other[1];
  return dx * dx + dy * dy;
}

function normalizeArrondissementName(name, refInsee) {
  const refMatch = String(refInsee || "").match(/^751(\d{2})$/);
  const fromRef = refMatch ? Number(refMatch[1]) : null;
  const text = String(name || "");
  const fromName = Number((text.match(/(\d+)(?:er|e)?\s+arrondissement/i) || [])[1]);
  const number = fromRef || fromName;
  if (number >= 1 && number <= 20) {
    return number === 1 ? "1er arrondissement" : `${number}e arrondissement`;
  }
  return text.trim();
}

function buildArrondissements(overpassJson) {
  const converted = osmtogeojson(overpassJson);
  const features = (converted.features || [])
    .filter((feature) => ["Polygon", "MultiPolygon"].includes(feature.geometry?.type))
    .map((feature) => {
      const osmTags = feature.properties?.tags || {};
      const name = normalizeArrondissementName(osmTags.name || feature.properties?.name, osmTags["ref:INSEE"]);
      const number = Number((name.match(/^(\d+)/) || [])[1]);
      return {
        type: "Feature",
        properties: {
          id: feature.properties?.id || osmTags.wikidata || name,
          nom_qua: name,
          name,
          arrondissement: number === 1 ? "1er" : `${number}e`,
          ref_INSEE: osmTags["ref:INSEE"] || "",
        },
        geometry: {
          type: feature.geometry.type,
          coordinates: roundGeometryCoordinates(feature.geometry.coordinates),
        },
      };
    })
    .filter((feature) => feature.properties.name)
    .sort((a, b) => Number(a.properties.ref_INSEE || 0) - Number(b.properties.ref_INSEE || 0));
  return { type: "FeatureCollection", features };
}

function findArrondissement(point, arrondissements) {
  return arrondissements.find((feature) => pointInFeature(point, feature)) || null;
}

function findNearestArrondissement(point, arrondissements) {
  let best = null;
  let bestDistance = Infinity;
  for (const feature of arrondissements) {
    const centroid = centroidOfGeometry(feature.geometry);
    if (!centroid) continue;
    const nextDistance = distanceSq(point, centroid);
    if (nextDistance < bestDistance) {
      best = feature;
      bestDistance = nextDistance;
    }
  }
  return best;
}

function buildStreets(overpassJson, arrondissements) {
  const converted = osmtogeojson(overpassJson);
  const seen = new Set();
  const skipped = { noName: 0, noGeometry: 0, noArrondissement: 0, fallback: 0, excludedTags: 0 };
  const features = [];

  for (const feature of converted.features || []) {
    const properties = feature.properties || {};
    const tags = properties.tags || {};
    const name = tags.name || properties.name;
    if (!name) {
      skipped.noName++;
      continue;
    }
    if (!feature.geometry || !["LineString", "MultiLineString", "Polygon", "MultiPolygon"].includes(feature.geometry.type)) {
      skipped.noGeometry++;
      continue;
    }
    if (shouldExcludeOsmTags(tags)) {
      skipped.excludedTags++;
      continue;
    }
    const centroid = centroidOfGeometry(feature.geometry);
    if (!centroid) {
      skipped.noGeometry++;
      continue;
    }
    let arrondissementFeature = findArrondissement(centroid, arrondissements);
    if (!arrondissementFeature) {
      arrondissementFeature = findNearestArrondissement(centroid, arrondissements);
      if (arrondissementFeature) skipped.fallback++;
    }
    if (!arrondissementFeature) {
      skipped.noArrondissement++;
      continue;
    }

    const key = `${name}|${feature.geometry.type}|${JSON.stringify(feature.geometry.coordinates).slice(0, 160)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const arrondissement = arrondissementFeature.properties.name;
    const lightProperties = {
      id: properties.id || `${features.length + 1}`,
      name,
      arrondissement,
      quartier: arrondissement,
      centroid,
      highway: tags.highway || tags.place || "",
      osm_id: properties.id || "",
    };
    const geometry = {
      type: feature.geometry.type,
      coordinates: roundGeometryCoordinates(feature.geometry.coordinates),
    };
    features.push({
      type: "Feature",
      properties: { ...lightProperties, osm_tags: tags },
      geometry,
      name,
      arrondissement,
      quartier: arrondissement,
      centroid,
    });
  }

  features.sort((a, b) => String(a.properties.name).localeCompare(String(b.properties.name), "fr"));
  return { features, skipped };
}

function buildLightFeatures(features) {
  return features
    .filter((feature) => shouldKeepStreetForGame({
      ...(feature.properties.osm_tags || {}),
      name: feature.properties.name,
    }))
    .map((feature) => ({
      type: "Feature",
      properties: {
        id: feature.properties.id,
        name: feature.properties.name,
        arrondissement: feature.properties.arrondissement,
        quartier: feature.properties.arrondissement,
        centroid: feature.properties.centroid,
        highway: feature.properties.highway,
        osm_id: feature.properties.osm_id,
      },
      geometry: feature.geometry,
      name: feature.properties.name,
      arrondissement: feature.properties.arrondissement,
      quartier: feature.properties.arrondissement,
      centroid: feature.properties.centroid,
    }));
}

function buildStreetIndex(lightFeatures) {
  const byName = new Map();
  for (const feature of lightFeatures) {
    const key = String(feature.properties.name || "").trim().toLowerCase();
    if (!key || byName.has(key)) continue;
    byName.set(key, {
      name: feature.properties.name,
      arrondissement: feature.properties.arrondissement,
      quartier: feature.properties.arrondissement,
      centroid: feature.properties.centroid,
    });
  }
  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

function buildMonuments() {
  return {
    type: "FeatureCollection",
    features: STATIC_MONUMENTS.map(([name, lon, lat], index) => ({
      type: "Feature",
      properties: { id: `paris-monument-${index + 1}`, name },
      geometry: { type: "Point", coordinates: [lon, lat] },
    })),
  };
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data)}\n`);
  console.log(`   écrit ${path.relative(PROJECT_DIR, filePath)} (${(fs.statSync(filePath).size / 1024).toFixed(1)} Ko)`);
}

async function main() {
  ensureDirs();
  console.log("🗺️  Synchronisation OSM → Parici");
  console.log("================================\n");

  console.log("📍 Chargement des arrondissements de Paris...");
  const arrRaw = await fetchOverpass(ARRONDISSEMENTS_QUERY, "arrondissements");
  const arrondissements = buildArrondissements(arrRaw);
  if (arrondissements.features.length < 20) {
    throw new Error(`Arrondissements incomplets: ${arrondissements.features.length}/20`);
  }
  console.log(`   ${arrondissements.features.length} arrondissements chargés.\n`);

  console.log("🛣️  Chargement des voies parisiennes...");
  const streetRaw = await fetchOverpass(STREETS_QUERY, "rues");
  const { features, skipped } = buildStreets(streetRaw, arrondissements.features);
  const lightFeatures = buildLightFeatures(features);
  console.log(`   ${features.length} géométries de voies, ${lightFeatures.length} retenues pour le jeu.`);
  console.log(`   Ignorées: ${skipped.noName} sans nom, ${skipped.noGeometry} sans géométrie, ${skipped.noArrondissement} sans arrondissement, ${skipped.excludedTags} tags exclus.`);
  console.log(`   Arrondissement par proximité: ${skipped.fallback}\n`);

  const enriched = { type: "FeatureCollection", features };
  const light = { type: "FeatureCollection", features: lightFeatures };
  const monuments = buildMonuments();
  const meta = {
    city: "Paris",
    insee: "75056",
    generated_at: new Date().toISOString(),
    streets_total: features.length,
    streets_light: lightFeatures.length,
    arrondissements: arrondissements.features.length,
    monuments: monuments.features.length,
  };

  writeJson(OUTPUT_ENRICHI, enriched);
  writeJson(OUTPUT_LIGHT, light);
  writeJson(OUTPUT_ARRONDISSEMENTS, arrondissements);
  writeJson(OUTPUT_MONUMENTS, monuments);
  writeJson(OUTPUT_SYNC_META, meta);
  writeJson(BACKEND_LIGHT, light);
  writeJson(BACKEND_ARRONDISSEMENTS, arrondissements);
  writeJson(BACKEND_MONUMENTS, monuments);
  writeJson(STREETS_INDEX, buildStreetIndex(lightFeatures));

  console.log("\n✅ Synchronisation Parici terminée.");
}

main().catch((error) => {
  console.error("\n❌ Synchronisation échouée:", error.message);
  process.exit(1);
});
