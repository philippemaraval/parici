#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const OVERPASS_URL = process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";
const OUTPUT_PATH = path.resolve(__dirname, "../data/paris_transit_lines.geojson");
const QUERY = `
[out:json][timeout:180];
(
  relation["type"="route"]["route"="subway"](48.10,1.40,49.30,3.60);
  relation["type"="route"]["route"="train"]["network"~"RER|Transilien|Île-de-France Mobilités|SNCF",i](48.10,1.40,49.30,3.60);
);
out geom;
`;

const FALLBACK_COLORS = {
  "1": "FFCD00", "2": "003CA6", "3": "837902", "3B": "6EC4E8",
  "4": "CF009E", "5": "FF7E2E", "6": "6ECA97", "7": "FA9ABA",
  "7B": "6ECA97", "8": "E19BDF", "9": "B6BD00", "10": "C9910D",
  "11": "704B1C", "12": "007852", "13": "6EC4E8", "14": "62259D",
  "A": "E2231A", "B": "4B92DB", "C": "F3D311", "D": "00814F", "E": "A0006E",
};

const ALLOWED_REFS = {
  Métro: new Set(["1", "2", "3", "3BIS", "4", "5", "6", "7", "7BIS", "8", "9", "10", "11", "12", "13", "14"]),
  RER: new Set(["A", "B", "C", "D", "E"]),
  Transilien: new Set(["H", "J", "K", "L", "N", "P", "R", "U", "V"]),
};

// About one metre around Paris: enough detail at the maximum game zoom while
// avoiding hundreds of thousands of points inherited from railway infrastructure.
const SIMPLIFICATION_TOLERANCE = 0.00001;

function normalizeRef(tags) {
  return String(tags.ref || tags.name || "")
    .replace(/^Métro\\s*/i, "")
    .replace(/^RER\\s*/i, "")
    .replace(/^Transilien\\s*/i, "")
    .trim()
    .toUpperCase();
}

function classify(tags) {
  if (tags.route === "subway") return "Métro";
  if (/RER/i.test(`${tags.network || ""} ${tags.name || ""}`)) return "RER";
  return "Transilien";
}

function geometryLines(element) {
  const lines = [];
  for (const member of element.members || []) {
    if (member.type !== "way" || !Array.isArray(member.geometry)) continue;
    const coordinates = member.geometry
      .map((point) => [Number(point.lon), Number(point.lat)])
      .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));
    if (coordinates.length >= 2) lines.push(coordinates);
  }
  return lines;
}

function squaredSegmentDistance(point, start, end) {
  let x = start[0];
  let y = start[1];
  let dx = end[0] - x;
  let dy = end[1] - y;

  if (dx || dy) {
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

function simplifyLine(coordinates, tolerance = SIMPLIFICATION_TOLERANCE) {
  if (coordinates.length <= 2) return coordinates;

  let furthestIndex = 0;
  let furthestDistance = 0;
  for (let index = 1; index < coordinates.length - 1; index += 1) {
    const distance = squaredSegmentDistance(
      coordinates[index],
      coordinates[0],
      coordinates[coordinates.length - 1],
    );
    if (distance > furthestDistance) {
      furthestDistance = distance;
      furthestIndex = index;
    }
  }

  if (furthestDistance <= tolerance * tolerance) {
    return [coordinates[0], coordinates[coordinates.length - 1]];
  }

  const left = simplifyLine(coordinates.slice(0, furthestIndex + 1), tolerance);
  const right = simplifyLine(coordinates.slice(furthestIndex), tolerance);
  return left.slice(0, -1).concat(right);
}

function optimizeGeometryLines(lines) {
  const uniqueLines = new Map();
  for (const coordinates of lines) {
    const simplified = simplifyLine(coordinates);
    const forwardKey = JSON.stringify(simplified);
    const reverseKey = JSON.stringify([...simplified].reverse());
    const key = forwardKey < reverseKey ? forwardKey : reverseKey;
    if (!uniqueLines.has(key)) uniqueLines.set(key, simplified);
  }
  return [...uniqueLines.values()];
}

async function main() {
  const response = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "User-Agent": "Camino-Paris/1.0",
    },
    body: new URLSearchParams({ data: QUERY }),
  });
  if (!response.ok) throw new Error(`Overpass request failed: HTTP ${response.status}`);

  const payload = await response.json();
  const grouped = new Map();
  for (const element of payload.elements || []) {
    const tags = element.tags || {};
    const ref = normalizeRef(tags);
    const type = classify(tags);
    const lines = geometryLines(element);
    if (!ref || !lines.length || !ALLOWED_REFS[type]?.has(ref)) continue;

    const key = `${type}:${ref}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        type: "Feature",
        properties: {
          name: `${type} ${ref}`,
          short_name: ref,
          transport_type: type,
          long_name: String(tags.name || "").trim(),
          color: String(tags.colour || FALLBACK_COLORS[ref] || "4057B2").replace(/^#/, ""),
          operator: String(tags.operator || "").trim(),
        },
        geometry: { type: "MultiLineString", coordinates: [] },
      });
    }
    grouped.get(key).geometry.coordinates.push(...lines);
  }

  const order = { Métro: 0, RER: 1, Transilien: 2 };
  const features = [...grouped.values()];
  features.forEach((feature) => {
    feature.geometry.coordinates = optimizeGeometryLines(feature.geometry.coordinates);
  });
  features.sort(
    (a, b) =>
      order[a.properties.transport_type] - order[b.properties.transport_type] ||
      a.properties.short_name.localeCompare(b.properties.short_name, "fr", { numeric: true }),
  );
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify({ type: "FeatureCollection", features }));
  console.log(`Wrote ${features.length} Paris transit lines to ${OUTPUT_PATH}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { optimizeGeometryLines, simplifyLine };
