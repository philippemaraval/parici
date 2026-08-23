#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SOURCE_CANDIDATES = [
  path.join(ROOT, "data", "paris_rues_light.geojson"),
  path.join(ROOT, "data", "paris_rues_light 2.geojson"),
  path.join(ROOT, "backend", "data", "paris_rues_light.geojson"),
  path.join(ROOT, "backend", "data", "paris_rues_light 2.geojson"),
];
const SOURCE_PATH = SOURCE_CANDIDATES.find((candidate) => fs.existsSync(candidate));
const OUTPUT_DIR = path.join(ROOT, "data", "map");
const MANIFEST_PATH = path.join(OUTPUT_DIR, "manifest.json");
const TOLERANCE = 0.000018;

function square(value) {
  return value * value;
}

function pointSegmentDistanceSquared(point, start, end) {
  let x = start[0];
  let y = start[1];
  let dx = end[0] - x;
  let dy = end[1] - y;
  if (dx !== 0 || dy !== 0) {
    const ratio = ((point[0] - x) * dx + (point[1] - y) * dy) / (dx * dx + dy * dy);
    if (ratio > 1) {
      x = end[0];
      y = end[1];
    } else if (ratio > 0) {
      x += dx * ratio;
      y += dy * ratio;
    }
  }
  dx = point[0] - x;
  dy = point[1] - y;
  return dx * dx + dy * dy;
}

function simplifyLine(points, tolerance = TOLERANCE) {
  if (!Array.isArray(points)) return points;
  const roundPoints = (coordinates) =>
    coordinates.map((point) => point.map((coordinate) => Number(coordinate.toFixed(5))));
  if (points.length <= 2) return roundPoints(points);
  const threshold = square(tolerance);
  const markers = new Uint8Array(points.length);
  const stack = [[0, points.length - 1]];
  markers[0] = 1;
  markers[points.length - 1] = 1;

  while (stack.length) {
    const [first, last] = stack.pop();
    let maxDistance = threshold;
    let splitIndex = 0;
    for (let index = first + 1; index < last; index += 1) {
      const distance = pointSegmentDistanceSquared(points[index], points[first], points[last]);
      if (distance > maxDistance) {
        splitIndex = index;
        maxDistance = distance;
      }
    }
    if (splitIndex) {
      markers[splitIndex] = 1;
      stack.push([first, splitIndex], [splitIndex, last]);
    }
  }

  return roundPoints(points.filter((_, index) => markers[index]));
}

function simplifyGeometry(geometry) {
  if (!geometry) return geometry;
  if (geometry.type === "LineString") {
    return { ...geometry, coordinates: simplifyLine(geometry.coordinates) };
  }
  if (geometry.type === "MultiLineString") {
    return { ...geometry, coordinates: geometry.coordinates.map((line) => simplifyLine(line)) };
  }
  return geometry;
}

function minifyFeature(feature) {
  return {
    type: "Feature",
    properties: {
      name: feature?.properties?.name || "",
      quartier: feature?.properties?.quartier || "",
      arrondissement: feature?.properties?.arrondissement || feature?.properties?.quartier || "",
    },
    geometry: simplifyGeometry(feature.geometry),
  };
}

function writeHashedGeoJson(label, features) {
  const payload = Buffer.from(JSON.stringify({ type: "FeatureCollection", features }));
  const hash = crypto.createHash("sha256").update(payload).digest("hex").slice(0, 12);
  const fileName = `${label}.${hash}.geojson`;
  fs.writeFileSync(path.join(OUTPUT_DIR, fileName), payload);
  return {
    url: `/data/map/${fileName}`,
    bytes: payload.length,
    features: features.length,
  };
}

function main() {
  if (!SOURCE_PATH) {
    throw new Error("Aucun fichier paris_rues_light GeoJSON disponible pour construire la carte.");
  }
  const source = JSON.parse(fs.readFileSync(SOURCE_PATH, "utf8"));
  const optimizedFeatures = (source.features || []).map(minifyFeature);
  fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const overview = writeHashedGeoJson("streets-overview", optimizedFeatures);
  const zones = {};
  const byArrondissement = new Map();
  for (const feature of optimizedFeatures) {
    const arrondissement = feature.properties.arrondissement || "SANS-ARRONDISSEMENT";
    if (!byArrondissement.has(arrondissement)) byArrondissement.set(arrondissement, []);
    byArrondissement.get(arrondissement).push(feature);
  }
  for (const [arrondissement, features] of [...byArrondissement.entries()].sort()) {
    const slug = arrondissement.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    zones[arrondissement] = writeHashedGeoJson(`arrondissement-${slug}`, features);
  }

  const manifest = {
    version: 1,
    sourceBytes: fs.statSync(SOURCE_PATH).size,
    tolerance: TOLERANCE,
    overview,
    zones,
  };
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `  ✅ Carte: ${(manifest.sourceBytes / 1024 / 1024).toFixed(1)} MB → `
      + `${(overview.bytes / 1024 / 1024).toFixed(1)} MB, ${Object.keys(zones).length} zones`,
  );
}

main();
