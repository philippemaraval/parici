const test = require("node:test");
const assert = require("node:assert/strict");
const {
  viewAlongStreet,
  axisDifference,
  candidateLocations,
} = require("../scripts/lib/collect-street-view");
const feature = (coordinates) => ({
  geometry: { type: "LineString", coordinates },
});
test("a winding street follows its local segment rather than the endpoint chord", () => {
  const street = feature([
    [5, 43],
    [5.002, 43],
    [5.002, 43.002],
    [5.004, 43.002],
  ]);
  const view = viewAlongStreet([5.00202, 43.001], [street]);
  assert.ok(axisDifference(view.heading, 0) < 1);
  assert.ok(view.distanceMeters > 1 && view.distanceMeters < 2);
  assert.ok(axisDifference(view.heading, 90) > 89);
});
test("direction reversal preserves the street axis and disconnected lines use the nearest part", () => {
  const streets = [
    feature([
      [5, 43],
      [5.002, 43],
    ]),
    feature([
      [5.01, 43],
      [5.01, 43.002],
    ]),
  ];
  const forward = viewAlongStreet([5.01, 43.001], streets);
  const reverse = viewAlongStreet([5.01, 43.001], streets, true);
  assert.ok(axisDifference(forward.heading, 0) < 1);
  assert.ok(
    Math.abs(((reverse.heading - forward.heading + 360) % 360) - 180) < 0.01,
  );
});
test("points, polygon rings and degenerate lines do not invent a street direction", () => {
  for (const geometry of [
    { type: "Point", coordinates: [5, 43] },
    {
      type: "Polygon",
      coordinates: [
        [
          [5, 43],
          [5.001, 43],
          [5, 43.001],
          [5, 43],
        ],
      ],
    },
    {
      type: "LineString",
      coordinates: [
        [5, 43],
        [5, 43],
      ],
    },
  ]) {
    assert.equal(viewAlongStreet([5, 43], [{ geometry }]), null);
  }
  assert.deepEqual(
    candidateLocations([{ geometry: { type: "Point", coordinates: [5, 43] } }]),
    [],
  );
});
