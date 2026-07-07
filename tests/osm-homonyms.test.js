const test = require("node:test");
const assert = require("node:assert/strict");

const {
  disambiguateHomonymousStreets,
} = require("../scripts/sync_osm");

function feature(name, coordinates, arrondissement = "1er arrondissement") {
  return {
    type: "Feature",
    properties: {
      name,
      arrondissement,
      quartier: arrondissement,
      osm_id: `way/${coordinates[0][0]}`,
    },
    geometry: { type: "LineString", coordinates },
    name,
    arrondissement,
    quartier: arrondissement,
    centroid: coordinates[0],
  };
}

test("renames every disconnected homonymous street with its dominant arrondissement", () => {
  const firstPart = feature("Boulevard Notre-Dame", [[2.1, 48.8], [2.2, 48.8]]);
  const secondPart = feature("Boulevard Notre-Dame", [[2.2, 48.8], [2.6, 48.8]]);
  const otherStreet = feature("Boulevard Notre-Dame", [[2.7, 48.9], [2.8, 48.9]], "2e arrondissement");
  const features = [firstPart, secondPart, otherStreet];

  const result = disambiguateHomonymousStreets(features);

  assert.deepEqual(result, { homonymousNames: 1, renamedComponents: 2 });
  assert.equal(firstPart.properties.name, "Boulevard Notre-Dame - 1er arrondissement");
  assert.equal(secondPart.properties.name, "Boulevard Notre-Dame - 1er arrondissement");
  assert.equal(otherStreet.properties.name, "Boulevard Notre-Dame - 2e arrondissement");
  assert.equal(firstPart.properties.osm_name, "Boulevard Notre-Dame");
  assert.equal(firstPart.name, firstPart.properties.name);
});

test("does not rename multiple connected OSM segments of one street", () => {
  const features = [
    feature("Rue Unique", [[2.1, 48.8], [2.2, 48.8]]),
    feature("Rue Unique", [[2.2, 48.8], [2.3, 48.8]]),
  ];

  const result = disambiguateHomonymousStreets(features);

  assert.deepEqual(result, { homonymousNames: 0, renamedComponents: 0 });
  assert.equal(features[0].properties.name, "Rue Unique");
  assert.equal(features[1].properties.name, "Rue Unique");
});

test("groups nearby carriageways and segments separated by a junction", () => {
  const features = [
    feature("Avenue Continue", [[2.1, 48.8], [2.2, 48.8]]),
    feature("Avenue Continue", [[2.2003, 48.8], [2.3, 48.8]]),
    feature("Avenue Continue", [[2.1, 48.8002], [2.3, 48.8002]]),
  ];

  const result = disambiguateHomonymousStreets(features);

  assert.deepEqual(result, { homonymousNames: 0, renamedComponents: 0 });
  assert.ok(features.every((candidate) => candidate.properties.name === "Avenue Continue"));
});

test("groups same street segments split by a roundabout-sized gap", () => {
  const features = [
    feature("Rue Interrompue", [[2.1, 48.8], [2.2, 48.8]]),
    feature("Rue Interrompue", [[2.201, 48.8], [2.3, 48.8]]),
  ];

  const result = disambiguateHomonymousStreets(features);

  assert.deepEqual(result, { homonymousNames: 0, renamedComponents: 0 });
  assert.ok(features.every((candidate) => candidate.properties.name === "Rue Interrompue"));
});

test("groups one street crossing arrondissements when segment endpoints are close", () => {
  const features = [
    feature("Chemin Traversant", [[2.1, 48.8], [2.49, 48.8]], "1er arrondissement"),
    feature("Chemin Traversant", [[2.4915, 48.8], [2.8, 48.8]], "2e arrondissement"),
  ];

  const result = disambiguateHomonymousStreets(features);

  assert.deepEqual(result, { homonymousNames: 0, renamedComponents: 0 });
  assert.ok(features.every((candidate) => candidate.properties.name === "Chemin Traversant"));
});

test("keeps distant same-arrondissement homonyms separated with their lengths", () => {
  const features = [
    feature("Impasse Distante", [[2.1, 48.8], [2.11, 48.8]]),
    feature("Impasse Distante", [[2.202, 48.8], [2.212, 48.8]]),
  ];

  disambiguateHomonymousStreets(features);

  assert.match(features[0].properties.name, /^Impasse Distante - 1er arrondissement - \d+ m(?: - \d+)?$/);
  assert.match(features[1].properties.name, /^Impasse Distante - 1er arrondissement - \d+ m(?: - \d+)?$/);
  assert.notEqual(features[0].properties.name, features[1].properties.name);
});

test("keeps the original name for non-homonymous streets", () => {
  const features = [feature("Rue Sans Homonyme", [[2.1, 48.8], [2.2, 48.8]])];

  disambiguateHomonymousStreets(features);

  assert.equal(features[0].properties.name, "Rue Sans Homonyme");
  assert.equal(features[0].properties.osm_name, undefined);
});
