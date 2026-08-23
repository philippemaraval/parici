const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

test("optimized street overview keeps every feature and is smaller", () => {
  const sourcePath = [
    path.join(ROOT, "data", "paris_rues_light.geojson"),
    path.join(ROOT, "data", "paris_rues_light 2.geojson"),
    path.join(ROOT, "backend", "data", "paris_rues_light.geojson"),
    path.join(ROOT, "backend", "data", "paris_rues_light 2.geojson"),
  ].find((candidate) => fs.existsSync(candidate));
  assert.ok(sourcePath, "Paris street source is missing");
  const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  const manifest = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data", "map", "manifest.json"), "utf8"),
  );
  const overviewPath = path.join(ROOT, manifest.overview.url.replace(/^\/+/, ""));
  const overview = JSON.parse(fs.readFileSync(overviewPath, "utf8"));
  assert.equal(overview.features.length, source.features.length);
  assert.ok(fs.statSync(overviewPath).size < fs.statSync(sourcePath).size);
  assert.ok(Object.keys(manifest.zones).length >= 20);
});

test("heavy optional runtimes are loaded on demand", () => {
  const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const serviceWorker = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  assert.doesNotMatch(indexHtml, /leaflet@1\.9\.4\/dist\/leaflet\.js/);
  assert.doesNotMatch(indexHtml, /canvas-confetti/);
  assert.doesNotMatch(serviceWorker, /CORE_PRECACHE_URLS[\s\S]*paris_rues_light/);
});
