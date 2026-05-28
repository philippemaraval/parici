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
  ["Hôtel des Invalides", 2.3126, 48.8566],
  ["Grand Palais", 2.3125, 48.8661],
  ["Petit Palais", 2.314, 48.866],
  ["Palais de Chaillot", 2.2886, 48.8629],
  ["Palais Royal", 2.3376, 48.8635],
  ["Conciergerie", 2.345, 48.8559],
  ["Sainte-Chapelle", 2.345, 48.8554],
  ["Tour Montparnasse", 2.3211, 48.8421],
  ["Bibliothèque nationale de France", 2.3765, 48.8337],
  ["Institut du Monde Arabe", 2.356, 48.8499],
  ["Moulin Rouge", 2.3322, 48.8841],
  ["Pont Alexandre III", 2.3136, 48.8639],
  ["Pont Neuf", 2.3417, 48.8571],
  ["Pont des Arts", 2.3376, 48.8584],
  ["Pont de Bir-Hakeim", 2.2876, 48.8557],
  ["Colonne de Juillet", 2.369, 48.8532],
  ["Colonne Vendôme", 2.3297, 48.8675],
  ["Obélisque de Louxor", 2.3212, 48.8656],
  ["Église de la Madeleine", 2.3244, 48.8701],
  ["Église Saint-Sulpice", 2.3344, 48.851],
  ["Église Saint-Eustache", 2.345, 48.8635],
  ["Église Saint-Germain-des-Prés", 2.3338, 48.8539],
  ["Église Saint-Étienne-du-Mont", 2.3488, 48.8465],
  ["Église Saint-Augustin", 2.3196, 48.8759],
  ["Église Saint-Roch", 2.3322, 48.8656],
  ["Église Saint-Paul-Saint-Louis", 2.3612, 48.855],
  ["Église Saint-Gervais-Saint-Protais", 2.3543, 48.8556],
  ["Église Saint-Séverin", 2.3456, 48.8526],
  ["Église Saint-Merri", 2.3509, 48.8596],
  ["Chapelle Expiatoire", 2.322, 48.8737],
  ["Palais du Luxembourg", 2.3372, 48.8487],
  ["Palais Bourbon", 2.3186, 48.861],
  ["Palais de l'Élysée", 2.3167, 48.8704],
  ["Hôtel de Matignon", 2.3205, 48.8547],
  ["Hôtel de Sully", 2.3641, 48.8552],
  ["Hôtel de Soubise", 2.3585, 48.86],
  ["Hôtel de Sens", 2.3594, 48.8532],
  ["Hôtel de Cluny", 2.3431, 48.8506],
  ["Musée Carnavalet", 2.3622, 48.8577],
  ["Musée Picasso", 2.3625, 48.8599],
  ["Musée Rodin", 2.3158, 48.8554],
  ["Musée de l'Orangerie", 2.3226, 48.8638],
  ["Musée du quai Branly - Jacques Chirac", 2.297, 48.8609],
  ["Palais de Tokyo", 2.2975, 48.8641],
  ["Musée d'Art Moderne de Paris", 2.2978, 48.864],
  ["Musée Guimet", 2.2936, 48.865],
  ["Musée Jacquemart-André", 2.3105, 48.8754],
  ["Musée Nissim de Camondo", 2.3123, 48.8799],
  ["Musée Grévin", 2.3422, 48.8718],
  ["Musée des Arts et Métiers", 2.3554, 48.866],
  ["Musée Marmottan Monet", 2.2673, 48.8591],
  ["Fondation Louis Vuitton", 2.263, 48.8766],
  ["Philharmonie de Paris", 2.394, 48.8915],
  ["Grande Halle de la Villette", 2.3902, 48.8893],
  ["Opéra Bastille", 2.3701, 48.8529],
  ["Comédie-Française", 2.3366, 48.8636],
  ["Théâtre du Châtelet", 2.3468, 48.8578],
  ["Théâtre de la Ville", 2.3472, 48.8575],
  ["Théâtre des Champs-Élysées", 2.3012, 48.8654],
  ["Olympia", 2.3284, 48.8708],
  ["Accor Arena", 2.3786, 48.8386],
  ["Stade Roland-Garros", 2.2493, 48.847],
  ["Gare du Nord", 2.3553, 48.8809],
  ["Gare de l'Est", 2.3599, 48.8768],
  ["Gare de Lyon", 2.373, 48.8443],
  ["Gare Saint-Lazare", 2.3244, 48.8763],
  ["Gare Montparnasse", 2.3206, 48.8412],
  ["Gare d'Austerlitz", 2.3657, 48.8423],
  ["Arènes de Lutèce", 2.3522, 48.845],
  ["Catacombes de Paris", 2.3322, 48.8339],
  ["Palais de la Porte Dorée", 2.4093, 48.8352],
  ["Bourse de Commerce - Pinault Collection", 2.342, 48.8628],
  ["Palais Brongniart", 2.3412, 48.8693],
  ["Tour Saint-Jacques", 2.3488, 48.8581],
  ["Fontaine Saint-Michel", 2.3431, 48.8533],
  ["Fontaine des Innocents", 2.3481, 48.8605],
  ["Fontaine Médicis", 2.3386, 48.8468],
  ["Fontaine Stravinsky", 2.3517, 48.8597],
  ["Statue de la Liberté", 2.28, 48.85],
  ["Flamme de la Liberté", 2.3009, 48.8645],
  ["Cité de l'Architecture et du Patrimoine", 2.2882, 48.8629],
  ["Musée de l'Armée", 2.3127, 48.8569],
  ["Musée national de la Marine", 2.2882, 48.8628],
  ["La Géode", 2.3884, 48.8956],
  ["Grande Mosquée de Paris", 2.3554, 48.8419],
  ["Institut de France", 2.3378, 48.8576],
  ["Monnaie de Paris", 2.3397, 48.8564],
  ["Collège de France", 2.3458, 48.8493],
  ["Sorbonne", 2.3431, 48.8488],
  ["École militaire", 2.3048, 48.851],
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
