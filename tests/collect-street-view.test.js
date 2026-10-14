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

test("extended photo sampling visits disconnected street segments", () => {
  const { photoLocations } = require("../scripts/enrich_collect_paris_photos");
  const features = [
    feature([
      [2.3, 48.85],
      [2.31, 48.85],
    ]),
    feature([
      [2.4, 48.86],
      [2.401, 48.86],
    ]),
  ];
  const samples = photoLocations(features, [2.3, 48.85], true);
  assert.ok(samples.some((p) => p[0] > 2.4));
  assert.ok(samples.some((p) => p[0] < 2.31));
  assert.equal(photoLocations(features, [2.3, 48.85]).length, 3);
});

test("exhaustive photo sampling keeps entrances and every disconnected portion", () => {
  const { photoLocations } = require("../scripts/enrich_collect_paris_photos");
  const { distance } = require("../scripts/lib/collect-street-view");
  const features = Array.from({ length: 6 }, (_, i) =>
    feature([
      [2.3 + i * 0.01, 48.85],
      [2.302 + i * 0.01, 48.85],
    ]),
  );
  const samples = photoLocations(features, [2.3, 48.85], true, true);
  for (const f of features) {
    const [start, end] = f.geometry.coordinates;
    const portion = samples.filter((p) => p[0] >= start[0] && p[0] <= end[0]);
    assert.deepEqual(portion[0], start);
    assert.deepEqual(portion.at(-1), end);
    for (let i = 1; i < portion.length; i++)
      assert.ok(distance(portion[i - 1], portion[i]) <= 15.01);
  }
});

test("square photographs aim into the surface and retain actual boundary distance", () => {
  const {
    photoLocations,
    streetPhotoView,
  } = require("../scripts/enrich_collect_paris_photos");
  const features = [
    {
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [2.3, 48.85],
            [2.302, 48.85],
            [2.302, 48.852],
            [2.3, 48.852],
            [2.3, 48.85],
          ],
          [
            [2.3008, 48.8508],
            [2.3012, 48.8508],
            [2.3012, 48.8512],
            [2.3008, 48.8512],
            [2.3008, 48.8508],
          ],
        ],
      },
    },
  ];
  const target = [2.301, 48.851];
  const samples = photoLocations(features, target, true);
  assert.ok(samples.length >= 8);
  assert.ok(
    !samples.some((p) => p[0] === target[0] && p[1] === target[1]),
    "do not sample a polygon hole as an interior point",
  );
  const job = { features, target };
  assert.equal(streetPhotoView([2.3005, 48.851], job).distanceMeters, 0);
  assert.ok(
    streetPhotoView([2.301, 48.851], job).distanceMeters > 18,
    "a hole is not inside the place",
  );
  assert.ok(streetPhotoView([2.29995, 48.851], job).distanceMeters < 18);
  assert.ok(streetPhotoView([2.299, 48.851], job).distanceMeters > 18);
  assert.ok(
    axisDifference(streetPhotoView([2.29995, 48.851], job).heading, 90) < 1,
  );
  assert.equal(
    streetPhotoView([2.3, 48.85], {
      features: [{ geometry: { type: "Point", coordinates: target } }],
      target,
    }),
    null,
  );
});
