const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  optimizeGeometryLines,
  simplifyLine,
} = require("../scripts/sync_paris_transit_lines.js");

test("transit line simplification keeps endpoints and meaningful bends", () => {
  const line = [
    [2, 48],
    [2.000001, 48.000001],
    [2.001, 48.002],
    [2.002, 48.002],
  ];

  assert.deepEqual(simplifyLine(line), [
    [2, 48],
    [2.001, 48.002],
    [2.002, 48.002],
  ]);
});

test("transit geometry optimization removes reversed duplicate ways", () => {
  const line = [
    [2, 48],
    [2.001, 48.001],
    [2.002, 48.002],
  ];

  assert.deepEqual(optimizeGeometryLines([line, [...line].reverse()]), [
    [
      [2, 48],
      [2.002, 48.002],
    ],
  ]);
});

test("transport lines are prepared in the background and rendered on canvas", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");
  const mapRuntimeSource = fs.readFileSync(
    path.join(__dirname, "../src/map-runtime.js"),
    "utf8",
  );

  assert.match(appSource, /scheduleAfterStartup\(\(\) => \{\s*loadBusLines\(\);/);
  assert.match(mapRuntimeSource, /const busLineRenderer = L\.canvas/);
  assert.match(mapRuntimeSource, /renderer: busLineRenderer/);
});
