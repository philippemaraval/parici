const test = require("node:test");
const assert = require("node:assert/strict");

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
