const test = require("node:test");
const assert = require("node:assert/strict");
const catalog = require("../data/collect_paris_catalog.json");
const descriptions = require("../data/collect_descriptions.json");
const {
  validateHeritageDescriptions,
} = require("../scripts/check_player_content");

test("all famous and main streets, monuments, districts and transport lines have their own sourced heritage sheet", () => {
  const counts = {};
  for (const key of Object.keys(descriptions)) {
    const family = key.split(":")[0];
    counts[family] = (counts[family] || 0) + 1;
  }
  assert.deepEqual(counts, {
    bus: 45,
    district: 80,
    monument: 107,
    street: 412,
  });
  assert.deepEqual(validateHeritageDescriptions(catalog, descriptions), []);
  for (const [key, entry] of Object.entries(descriptions)) {
    assert.equal(
      (entry.short.match(/\(/g) || []).length,
      (entry.short.match(/\)/g) || []).length,
      key,
    );
    assert.doesNotMatch(entry.short, /\b(?:M|Mme|S|J|C|L)\.$/, key);
  }

  assert.equal(
    new Set(Object.values(descriptions).map((entry) => entry.text)).size,
    644,
  );
});

test("editorial validation detects a missing card, a cartographic source and a stale generated catalog", () => {
  const altered = structuredClone(descriptions);
  delete altered["street:Rue Cler"];
  altered["monument:Tour Eiffel"].source =
    "https://www.openstreetmap.org/copyright";
  altered["district:Quartier de Croulebarbe"].text +=
    " Un complément à régénérer.";
  const errors = validateHeritageDescriptions(catalog, altered);
  assert.ok(
    errors.some((error) =>
      error.includes("street:Rue Cler: fiche patrimoniale absente"),
    ),
  );
  assert.ok(
    errors.some((error) =>
      error.includes("monument:Tour Eiffel: source historique"),
    ),
  );
  assert.ok(
    errors.some((error) =>
      error.includes(
        "district:Quartier de Croulebarbe: catalogue non régénéré",
      ),
    ),
  );
});

test("Paris-specific identities avoid homonym pages and known historical mistakes", () => {
  assert.match(
    descriptions["district:Quartier Les Îles"].source,
    /Quartier_Notre-Dame_\(Paris\)/,
  );
  assert.match(descriptions["district:Vivienne"].source, /Quartier_Vivienne$/);
  assert.match(descriptions["monument:Palais Royal"].source, /Palais-Royal$/);
  assert.match(
    descriptions["monument:Conciergerie"].source,
    /paris-conciergerie\.fr/,
  );
  assert.match(
    descriptions["street:Rue d'Oradour-sur-Glane"].text,
    /10 juin 1944/,
  );
  assert.doesNotMatch(
    descriptions["street:Rue d'Oradour-sur-Glane"].text,
    /juillet/,
  );
  assert.match(
    descriptions["street:Rue Oberkampf"].text,
    /Christophe-Philippe/,
  );
  assert.match(descriptions["bus:Tramway T14"].text, /22 mars 2025/);
});
