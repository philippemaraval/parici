const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

function loadMapDistanceHelpers() {
  const source = fs
    .readFileSync(path.join(ROOT, "src/map.js"), "utf8")
    .replace(/export function /g, "function ");
  const context = vm.createContext({ console });
  vm.runInContext(`${source}
    globalThis.getDistanceMeters = getDistanceMeters;
    globalThis.getDistanceToFeature = getDistanceToFeature;
    globalThis.computeFeatureCollectionMidpoint = computeFeatureCollectionMidpoint;
  `, context);
  return context;
}

test("daily guesses use street midpoints for target and clicked streets", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/app.js"), "utf8");

  assert.match(
    source,
    /buildDailyTargetFeatureCollection\(dailyTargetData\.streetName\)/,
  );
  assert.match(
    source,
    /buildDailyTargetFeatureCollection\(e\.properties\.name\)/,
  );
  assert.match(source, /computeFeatureCollectionMidpoint\(targetFeatureCollection\)/);
  assert.match(source, /computeFeatureCollectionMidpoint\(guessFeatureCollection\)/);
  assert.doesNotMatch(
    source,
    /buildDailyTargetFeatureCollection\(dailyTargetData\)/,
  );
});

test("daily street clicks display a durable red midpoint marker above streets", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/app.js"), "utf8");

  assert.match(source, /showDailyStreetMidpointMarker\(e, t\)/);
  assert.match(source, /DAILY_STREET_MIDPOINT_MARKER_PANE = "dailyStreetMidpointMarkerPane"/);
  assert.match(source, /pane\.style\.zIndex = "625"/);
  assert.match(source, /dailyStreetMidpointRenderer = L\.svg\(\{/);
  assert.match(source, /computeFeatureCollectionMidpoint\(layer\?\.feature \|\| feature\) \|\| getLayerMidpoint\(layer\)/);
  assert.match(source, /L\.circleMarker\(\[midpoint\[1\], midpoint\[0\]\]/);
  assert.match(source, /radius: Math\.max\(5, strokeWidth \/ 2\)/);
  assert.match(source, /fillColor: "#FF0000"/);
  assert.match(source, /stroke: true/);
  assert.match(source, /color: "#FFFFFF"/);
  assert.match(source, /pane: DAILY_STREET_MIDPOINT_MARKER_PANE/);
  assert.match(source, /renderer/);
  assert.match(source, /type: "MultiLineString"/);
});

test("daily target reveal preserves the current map view", () => {
  const appSource = fs.readFileSync(path.join(ROOT, "src/app.js"), "utf8");
  const runtimeSource = fs.readFileSync(path.join(ROOT, "src/daily-runtime.js"), "utf8");

  assert.match(appSource, /fitBounds: false/);
  assert.match(runtimeSource, /fitBounds = true/);
  assert.match(runtimeSource, /if \(!fitBounds\) \{\s*return nextLayer;\s*\}/);
});

test("feature collection midpoint is the point halfway along the whole street length", () => {
  const { computeFeatureCollectionMidpoint } = loadMapDistanceHelpers();
  const midpoint = computeFeatureCollectionMidpoint({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [5, 43],
            [5.001, 43],
          ],
        },
      },
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [5.001, 43],
            [5.003, 43],
          ],
        },
      },
    ],
  });

  assert.ok(Math.abs(midpoint[0] - 5.0015) < 0.00001, `unexpected lon ${midpoint[0]}`);
  assert.equal(midpoint[1], 43);
});

test("distance helper measures the shortest metric distance to a street segment", () => {
  const { getDistanceToFeature } = loadMapDistanceHelpers();
  const distance = getDistanceToFeature(43.295, 5.0001, {
    type: "LineString",
    coordinates: [
      [5, 43.294],
      [5, 43.296],
    ],
  });

  assert.ok(distance > 7, `expected a positive distance, got ${distance}`);
  assert.ok(distance < 10, `expected about 8 meters, got ${distance}`);
});
