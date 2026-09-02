const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildStreets,
  extractOsmTags,
  isExcludedStreetAreaTags,
  isExcludedWoodCorridorStreetName,
  isManuallyExcludedStreetName,
} = require("../scripts/sync_osm");
const { shouldKeepStreetForGame } = require("../street_filter");

const TEST_ARRONDISSEMENT = {
  type: "Feature",
  properties: {
    name: "Quartier Test",
    quartier: "Quartier Test",
  },
  geometry: {
    type: "Polygon",
    coordinates: [[[2, 48], [3, 48], [3, 49], [2, 49], [2, 48]]],
  },
};

const TEST_EXCLUDED_WOOD = {
  type: "Feature",
  properties: { name: "Bois de Test" },
  geometry: {
    type: "Polygon",
    coordinates: [[[2.34, 48.84], [2.36, 48.84], [2.36, 48.86], [2.34, 48.86], [2.34, 48.84]]],
  },
};

function overpassFixture() {
  return {
    version: 0.6,
    elements: [
      { type: "node", id: 1, lat: 48.85, lon: 2.35 },
      { type: "node", id: 2, lat: 48.851, lon: 2.351 },
      { type: "node", id: 3, lat: 48.86, lon: 2.36 },
      { type: "node", id: 4, lat: 48.861, lon: 2.361 },
      { type: "node", id: 5, lat: 48.87, lon: 2.37 },
      { type: "node", id: 6, lat: 48.871, lon: 2.371 },
      {
        type: "way",
        id: 10,
        nodes: [1, 2],
        tags: { name: "Sentier Inutile", highway: "path" },
      },
      {
        type: "way",
        id: 20,
        nodes: [3, 4],
        tags: { name: "Rue Privée", highway: "residential", access: "private" },
      },
      {
        type: "way",
        id: 30,
        nodes: [5, 6],
        tags: { name: "Rue Publique", highway: "residential" },
      },
    ],
  };
}

test("Paris OSM import extracts flat osmtogeojson tags before filtering", () => {
  const tags = extractOsmTags({
    id: "way/1",
    name: "Rue Test",
    highway: "residential",
    access: "private",
  });

  assert.deepEqual(tags, {
    name: "Rue Test",
    highway: "residential",
    access: "private",
  });
  assert.equal(shouldKeepStreetForGame(tags), false);
});

test("Paris street filter excludes lettered quays", () => {
  for (const letter of ["A", "B", "C", "D", "E", "F"]) {
    assert.equal(shouldKeepStreetForGame({ name: `Quai ${letter}` }), false);
  }
  assert.equal(shouldKeepStreetForGame({ name: "Quai Branly" }), true);
});

test("Paris street filter excludes duplicate display names", () => {
  const excludedNames = [
    "Esplanade Pierre Vidal-Naquet",
    "Promenade Bernard Lafray - Quartier de la Plaine-de-Monceau - 6 m",
    "Promenade Bernard Lafray - Quartier de la Plaine-de-Monceau - 14 m",
    "Rond-point des Champs-Elysées",
    "Rond-point des Champs-Élysées-Marcel-Dassault",
  ];
  for (const name of excludedNames) {
    assert.equal(shouldKeepStreetForGame({ name }), false);
    assert.equal(isManuallyExcludedStreetName(name), true);
  }
});

test("Paris OSM import excludes paths and private streets from generated streets", () => {
  const { features, skipped } = buildStreets(overpassFixture(), [TEST_ARRONDISSEMENT]);

  assert.equal(skipped.excludedTags, 2);
  assert.deepEqual(features.map((feature) => feature.properties.name), ["Rue Publique"]);
  assert.equal(features[0].properties.highway, "residential");
  assert.equal(features[0].properties.osm_tags.highway, "residential");
});

test("Paris OSM import excludes streets located inside excluded woods", () => {
  const fixture = {
    version: 0.6,
    elements: [
      { type: "node", id: 1, lat: 48.85, lon: 2.35 },
      { type: "node", id: 2, lat: 48.851, lon: 2.351 },
      { type: "node", id: 3, lat: 48.88, lon: 2.8 },
      { type: "node", id: 4, lat: 48.881, lon: 2.801 },
      {
        type: "way",
        id: 10,
        nodes: [1, 2],
        tags: { name: "Rue du Bois", highway: "residential" },
      },
      {
        type: "way",
        id: 20,
        nodes: [3, 4],
        tags: { name: "Rue Hors Bois", highway: "residential" },
      },
    ],
  };

  const { features, skipped } = buildStreets(
    fixture,
    [TEST_ARRONDISSEMENT],
    [TEST_EXCLUDED_WOOD],
  );

  assert.equal(skipped.excludedAreas, 1);
  assert.deepEqual(features.map((feature) => feature.properties.name), ["Rue Hors Bois"]);
});

test("Paris OSM import treats all parks and gardens as excluded street areas", () => {
  assert.equal(isExcludedStreetAreaTags({ leisure: "park", name: "Parc de Test" }), true);
  assert.equal(isExcludedStreetAreaTags({ leisure: "garden", name: "Jardin de Test" }), true);
  assert.equal(isExcludedStreetAreaTags({ leisure: "pitch", name: "Terrain de Test" }), false);
});

test("Paris OSM wood exclusion ignores inner polygon holes", () => {
  const fixture = {
    version: 0.6,
    elements: [
      { type: "node", id: 1, lat: 48.85, lon: 2.35 },
      { type: "node", id: 2, lat: 48.851, lon: 2.351 },
      {
        type: "way",
        id: 10,
        nodes: [1, 2],
        tags: { name: "Route dans un Trou", highway: "residential" },
      },
    ],
  };
  const woodWithHole = {
    type: "Feature",
    properties: { name: "Bois de Test" },
    geometry: {
      type: "Polygon",
      coordinates: [
        [[2.34, 48.84], [2.36, 48.84], [2.36, 48.86], [2.34, 48.86], [2.34, 48.84]],
        [[2.349, 48.849], [2.352, 48.849], [2.352, 48.852], [2.349, 48.852], [2.349, 48.849]],
      ],
    },
  };

  const { features, skipped } = buildStreets(
    fixture,
    [TEST_ARRONDISSEMENT],
    [woodWithHole],
  );

  assert.equal(skipped.excludedAreas, 1);
  assert.deepEqual(features, []);
});

test("Paris OSM import excludes named wood road corridors missed by park polygons", () => {
  const fixture = {
    version: 0.6,
    elements: [
      { type: "node", id: 1, lat: 48.85, lon: 2.35 },
      { type: "node", id: 2, lat: 48.851, lon: 2.351 },
      { type: "node", id: 3, lat: 48.88, lon: 2.8 },
      { type: "node", id: 4, lat: 48.881, lon: 2.801 },
      {
        type: "way",
        id: 10,
        nodes: [1, 2],
        tags: { name: "Route de la Pyramide", highway: "tertiary" },
      },
      {
        type: "way",
        id: 20,
        nodes: [3, 4],
        tags: { name: "Route des Petits Ponts", highway: "primary" },
      },
    ],
  };

  const { features, skipped } = buildStreets(fixture, [TEST_ARRONDISSEMENT]);

  assert.equal(isExcludedWoodCorridorStreetName("Route de la Pyramide"), true);
  assert.equal(isExcludedWoodCorridorStreetName("Route des Petits Ponts"), false);
  assert.equal(skipped.excludedWoodNames, 1);
  assert.deepEqual(features.map((feature) => feature.properties.name), ["Route des Petits Ponts"]);
});

test("Paris OSM import applies manual street exclusions without excluding nearby types", () => {
  const fixture = {
    version: 0.6,
    elements: [
      { type: "node", id: 1, lat: 48.85, lon: 2.35 },
      { type: "node", id: 2, lat: 48.851, lon: 2.351 },
      { type: "node", id: 3, lat: 48.86, lon: 2.36 },
      { type: "node", id: 4, lat: 48.861, lon: 2.361 },
      { type: "node", id: 5, lat: 48.87, lon: 2.37 },
      { type: "node", id: 6, lat: 48.871, lon: 2.371 },
      { type: "node", id: 7, lat: 48.88, lon: 2.38 },
      { type: "node", id: 8, lat: 48.881, lon: 2.381 },
      {
        type: "way",
        id: 10,
        nodes: [1, 2],
        tags: { name: "Escalier A", highway: "steps" },
      },
      {
        type: "way",
        id: 20,
        nodes: [3, 4],
        tags: { name: "Autoroute de Normandie", highway: "motorway" },
      },
      {
        type: "way",
        id: 30,
        nodes: [5, 6],
        tags: { name: "rampe PMR", highway: "footway" },
      },
      {
        type: "way",
        id: 40,
        nodes: [7, 8],
        tags: { name: "Rampe Caulaincourt", highway: "residential" },
      },
    ],
  };

  const { features, skipped } = buildStreets(fixture, [TEST_ARRONDISSEMENT]);

  assert.equal(isManuallyExcludedStreetName("Escalier Daumesnil (accès PC12)"), true);
  assert.equal(isManuallyExcludedStreetName("Autoroute de l’Est"), true);
  assert.equal(isManuallyExcludedStreetName("Bretelle de contournement de la place Valhubert"), true);
  assert.equal(isManuallyExcludedStreetName("Quai A"), true);
  assert.equal(isManuallyExcludedStreetName("Quai F"), true);
  assert.equal(isManuallyExcludedStreetName("Rampe Caulaincourt"), false);
  assert.equal(skipped.excludedManualNames, 3);
  assert.deepEqual(features.map((feature) => feature.properties.name), ["Rampe Caulaincourt"]);
});
