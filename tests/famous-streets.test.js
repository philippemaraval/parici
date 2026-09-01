const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const streetIndex = require("../backend/data/streets_index.json");
const { FAMOUS_STREET_NAMES, MAIN_STREET_NAMES, MONUMENT_NAMES } = require("../data_rules.js");

const normalizeName = (value) => String(value || "").trim().toLocaleLowerCase("fr-FR");
const playableNames = new Set(streetIndex.map((entry) => normalizeName(entry.name)));

const readGeoJson = (relativePath) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8"));

test("the famous-streets selection contains 106 playable Paris ways", () => {
  assert.equal(FAMOUS_STREET_NAMES.size, 106);
  for (const streetName of FAMOUS_STREET_NAMES) {
    assert.ok(playableNames.has(streetName), `${streetName} is missing from the street index`);
  }
});

test("the selection keeps iconic local streets and uses the playable République name", () => {
  assert.ok(FAMOUS_STREET_NAMES.has("rue de l'abreuvoir"));
  assert.ok(FAMOUS_STREET_NAMES.has("rue montorgueil"));
  assert.ok(FAMOUS_STREET_NAMES.has("place de la république - quartier de la folie-méricourt"));
  assert.ok(FAMOUS_STREET_NAMES.has("pont neuf"));
  assert.ok(FAMOUS_STREET_NAMES.has("rue saint-louis en l'île"));
  assert.ok(FAMOUS_STREET_NAMES.has("place des victoires"));
  assert.ok(FAMOUS_STREET_NAMES.has("place des abbesses"));
  assert.ok(FAMOUS_STREET_NAMES.has("rue du faubourg saint-denis"));
  assert.ok(FAMOUS_STREET_NAMES.has("quai d'anjou"));
  assert.ok(FAMOUS_STREET_NAMES.has("rue de bretagne"));
});

test("the selection is not padded with the boulevards des Maréchaux", () => {
  for (const streetName of [
    "boulevard kellermann",
    "boulevard murat",
    "boulevard poniatowski",
    "boulevard bessières",
  ]) {
    assert.equal(FAMOUS_STREET_NAMES.has(streetName), false);
  }
});

test("the main-streets selection contains 361 selected movement axes", () => {
  const pendingOsmStreetNames = new Set(["boulevard de l'hôpital"]);

  assert.equal(MAIN_STREET_NAMES.size, 361);
  for (const streetName of MAIN_STREET_NAMES) {
    if (pendingOsmStreetNames.has(streetName)) continue;
    assert.ok(playableNames.has(streetName), `${streetName} is missing from the street index`);
  }
  assert.deepEqual(
    [...MAIN_STREET_NAMES].filter((streetName) => !playableNames.has(streetName)),
    [...pendingOsmStreetNames],
  );

  for (const streetName of [
    "boulevard kellermann",
    "avenue de flandre",
    "rue de tolbiac",
    "rue des pyrénées",
    "quai de bercy",
    "place de la concorde",
    "place de la république - quartier de la folie-méricourt",
    "boulevard de l'hôpital",
    "rue du faubourg saint-denis",
    "place de la madeleine",
    "boulevard jules ferry",
    "boulevard des filles du calvaire",
    "rue claude bernard",
    "avenue claude vellefaux",
    "rue saint-charles",
    "avenue de laumière",
    "rue manin",
    "rue marcadet",
  ]) {
    assert.ok(MAIN_STREET_NAMES.has(streetName), `${streetName} should be a main movement axis`);
  }
});

test("main movement axes do not inflate the famous-streets selection", () => {
  for (const streetName of ["boulevard kellermann", "avenue de flandre", "rue de tolbiac"]) {
    assert.equal(FAMOUS_STREET_NAMES.has(streetName), false);
  }
});

test("the monument selection contains 107 synchronized entries", () => {
  const frontend = readGeoJson("data/paris_monuments.geojson");
  const backend = readGeoJson("backend/data/paris_monuments.geojson");
  const monumentNames = new Set(frontend.features.map((feature) => normalizeName(feature.properties?.name)));

  assert.equal(frontend.features.length, 107);
  assert.deepEqual(backend, frontend);
  assert.deepEqual(monumentNames, MONUMENT_NAMES);
  for (const monumentName of [
    "hôtel de la marine",
    "cité des sciences et de l'industrie",
    "porte saint-denis",
    "porte saint-martin",
    "mémorial de la shoah",
    "grande galerie de l'évolution",
    "arc de triomphe du carrousel",
  ]) {
    assert.ok(MONUMENT_NAMES.has(monumentName), `${monumentName} should be selected`);
  }
});

test("the monument selection represents every Paris arrondissement", () => {
  const representativeByArrondissement = new Map([
    [1, "musée du louvre"],
    [2, "palais brongniart"],
    [3, "musée picasso"],
    [4, "cathédrale notre-dame de paris"],
    [5, "panthéon"],
    [6, "palais du luxembourg"],
    [7, "tour eiffel"],
    [8, "grand palais"],
    [9, "opéra garnier"],
    [10, "gare du nord"],
    [11, "bataclan"],
    [12, "palais de la porte dorée"],
    [13, "bibliothèque nationale de france"],
    [14, "catacombes de paris"],
    [15, "tour montparnasse"],
    [16, "palais de chaillot"],
    [17, "cité de l'économie - hôtel gaillard"],
    [18, "sacré-cœur"],
    [19, "philharmonie de paris"],
    [20, "cimetière du père-lachaise"],
  ]);

  assert.equal(representativeByArrondissement.size, 20);
  for (const [arrondissement, monumentName] of representativeByArrondissement) {
    assert.ok(MONUMENT_NAMES.has(monumentName), `${arrondissement}e: ${monumentName} is missing`);
  }
});
