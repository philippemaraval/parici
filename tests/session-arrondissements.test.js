const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  createArrondissementResolver,
} = require("../backend/domains/game-integrity/arrondissements");
const quarters = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../data/paris_quartiers.geojson"),
    "utf8",
  ),
);
const resolve = createArrondissementResolver(quarters);

test("server and browser assign every real Paris street to the same arrondissement", async (t) => {
  const source = fs.readFileSync(
    path.join(__dirname, "../src/map-runtime.js"),
    "utf8",
  );
  const { loadStreetsRuntime } = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  );
  const streets = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "../data/paris_rues_light.geojson"),
      "utf8",
    ),
  );
  const expected = streets.features.map((f) =>
    resolve(f.properties.arrondissement),
  );
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).includes("manifest.json"))
      return Response.json({}, { status: 404 });
    return Response.json(
      String(url).includes("paris_quartiers") ? quarters : streets,
    );
  });
  const result = await loadStreetsRuntime({
    map: {},
    L: {
      geoJSON: () => ({
        addTo() {
          return this;
        },
        addData() {},
      }),
    },
    normalizeName: (value) => value,
  });
  const counts = new Map();
  result.allStreetFeatures.forEach((feature, index) => {
    assert.equal(
      feature.properties.arrondissement,
      expected[index],
      feature.properties.name,
    );
    counts.set(expected[index], (counts.get(expected[index]) || 0) + 1);
  });
  assert.equal(counts.size, 20);
  for (let number = 1; number <= 20; number++) {
    const label =
      number === 1 ? "1er arrondissement" : `${number}e arrondissement`;
    assert.ok(counts.get(label) > 0, label);
    assert.equal(resolve(label), label);
  }
});
