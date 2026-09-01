const assert = require("node:assert/strict");
const test = require("node:test");

const streetIndex = require("../backend/data/streets_index.json");
const { FAMOUS_STREET_NAMES } = require("../data_rules.js");

test("the famous-streets selection contains 150 playable Paris ways", () => {
  const playableNames = new Set(
    streetIndex.map((entry) => String(entry.name || "").trim().toLocaleLowerCase("fr-FR")),
  );

  assert.equal(FAMOUS_STREET_NAMES.size, 150);
  for (const streetName of FAMOUS_STREET_NAMES) {
    assert.ok(playableNames.has(streetName), `${streetName} is missing from the street index`);
  }
});

test("the selection keeps iconic local streets and uses the playable République name", () => {
  assert.ok(FAMOUS_STREET_NAMES.has("rue de l'abreuvoir"));
  assert.ok(FAMOUS_STREET_NAMES.has("rue montorgueil"));
  assert.ok(FAMOUS_STREET_NAMES.has("place de la république - quartier de la folie-méricourt"));
  assert.ok(FAMOUS_STREET_NAMES.has("pont neuf"));
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
