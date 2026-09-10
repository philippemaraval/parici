const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(
  path.join(__dirname, "../src/map-runtime.js"),
  "utf8",
);
const runtime = import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);
const streets = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { name: "Rue du Test" },
      geometry: {
        type: "LineString",
        coordinates: [
          [2.3, 48.8],
          [2.31, 48.81],
        ],
      },
    },
  ],
};

for (const broken of [
  "<!doctype html><title>Parici</title>",
  JSON.stringify({ features: [] }),
]) {
  test(`a stale map manifest falls back after an unusable HTTP 200 response: ${broken.slice(0, 20)}`, async (t) => {
    const requests = [];
    t.mock.method(globalThis, "fetch", async (url) => {
      requests.push(String(url));
      if (String(url).includes("manifest.json"))
        return Response.json({ overview: { url: "/data/map/old.geojson" } });
      if (String(url).includes("old.geojson"))
        return new Response(broken, { status: 200 });
      if (String(url).includes("paris_quartiers"))
        return Response.json({ features: [] });
      return Response.json(streets);
    });
    const { loadStreetsRuntime } = await runtime;
    const result = await loadStreetsRuntime({
      map: {},
      L: { geoJSON: () => ({ addTo: () => ({}) }) },
      normalizeName: (x) => x,
    });
    assert.equal(result.allStreetFeatures.length, 1);
    assert.match(result.loadedFrom, /paris_rues_light/);
    assert.ok(requests.some((x) => x.includes("paris_rues_light")));
  });
}
