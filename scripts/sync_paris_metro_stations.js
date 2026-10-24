#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const SOURCE =
  "https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/arrets/exports/json?where=arrtype%3D%22metro%22";
// The reference also classifies the Montmartre funicular and future line 18
// platforms as metro. Neither belongs in the operating metro catalogue.
// Line 18 opening: IDFM press release, 24 September 2026 (December 2026).
const EXCLUDED_NAMES = new Set([
  "Funiculaire Gare basse",
  "Funiculaire Gare haute",
  "Antony",
  "Massy - Palaiseau",
  "Polytechnique",
  "Université Paris-Saclay",
  "Christ de Saclay",
]);
function buildMetroStations(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (row.arrtype !== "metro" || EXCLUDED_NAMES.has(row.arrname)) continue;
    const { lon, lat } = row.arrgeopoint || {};
    if (
      !row.zdaid ||
      !row.arrname ||
      !Number.isFinite(lon) ||
      !Number.isFinite(lat)
    )
      throw new Error("Invalid metro station in IDFM reference");
    const key = String(row.zdaid);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const features = [...groups.entries()]
    .map(([id, platforms]) => {
      const name = platforms[0].arrname;
      if (platforms.some((row) => row.arrname !== name))
        throw new Error(`Inconsistent station ${id}`);
      const coordinates = ["lon", "lat"].map((axis) =>
        Number(
          (
            platforms.reduce((sum, row) => sum + row.arrgeopoint[axis], 0) /
            platforms.length
          ).toFixed(6),
        ),
      );
      return {
        type: "Feature",
        id: `idfm:metro:${id}`,
        properties: { name, station_id: id, mode: "metro" },
        geometry: { type: "Point", coordinates },
      };
    })
    .sort((a, b) => a.properties.name.localeCompare(b.properties.name, "fr"));
  if (new Set(features.map((f) => f.properties.name)).size !== features.length)
    throw new Error("Duplicate metro station names");
  return {
    type: "FeatureCollection",
    source: SOURCE,
    license: "Licence Ouverte 2.0 - Île-de-France Mobilités",
    features,
  };
}
async function main() {
  const rows = process.argv[2]
    ? JSON.parse(fs.readFileSync(process.argv[2], "utf8"))
    : await fetch(SOURCE).then((response) => {
        if (!response.ok) throw new Error(`IDFM HTTP ${response.status}`);
        return response.json();
      });
  const data = buildMetroStations(rows);
  if (data.features.length < 300) throw new Error("Incomplete metro reference");
  fs.writeFileSync(
    path.resolve(__dirname, "../data/paris_metro_stations.geojson"),
    JSON.stringify(data) + "\n",
  );
  console.log(`${data.features.length} metro stations written`);
}
if (require.main === module)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
module.exports = { buildMetroStations };
