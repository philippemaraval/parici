const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const readJson = (relativePath) =>
  JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));

test("content datasets keep the expected Parici depth", () => {
  const quartiers = readJson("data/paris_arrondissements.geojson").features;
  const monuments = readJson("data/paris_monuments.geojson").features;
  const transit = readJson("data/paris_transit_lines.geojson").features;
  const manifest = fs
    .readFileSync(path.join(ROOT, "data/daily_images/manifest_next_30.csv"), "utf8")
    .trim()
    .split(/\r?\n/)
    .slice(1);

  assert.equal(quartiers.length, 80);
  assert.equal(new Set(quartiers.map((feature) => feature.properties.name)).size, 80);
  assert.equal(monuments.length, 107);
  assert(transit.filter((feature) => feature.properties.transport_type === "Tramway").length >= 15);
  assert(manifest.length >= 365);
});
