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
    street: 1420,
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
    1652,
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

test("every common, uncommon, rare and legendary card has a complete heritage sheet", () => {
  const counts = {};
  for (const card of catalog.records) {
    const rarity = card.fragments_required > 0 ? 5 : card.base_rarity;
    if (![1, 2, 3, 5].includes(rarity)) continue;
    counts[rarity] = (counts[rarity] || 0) + 1;
    assert.ok(descriptions[card.family + ":" + card.source_entity_id]);
  }
  assert.deepEqual(counts, { 1: 182, 2: 306, 3: 146, 5: 18 });
  const unlisted = catalog.records.find(
    (card) => !descriptions[card.family + ":" + card.source_entity_id],
  );
  for (const rarity of [1, 2, 3, 5]) {
    const card = {
      ...unlisted,
      base_rarity: rarity,
      fragments_required: rarity === 5 ? 3 : 0,
    };
    assert.ok(
      validateHeritageDescriptions({ records: [card] }, descriptions).some(
        (error) => error.includes("fiche patrimoniale absente"),
      ),
    );
  }
});

test("the new epic batch contains exactly 1000 distinct, sourced epic cards", () => {
  const batch = require("./fixtures/collect-heritage-epic-20261015.json");
  assert.equal(batch.length, 1000);
  assert.equal(new Set(batch).size, 1000);
  assert.equal(
    new Set(batch.map((key) => descriptions[key].source_record_id)).size,
    1000,
  );
  const cards = new Map(
    catalog.records.map((card) => [
      card.family + ":" + card.source_entity_id,
      card,
    ]),
  );
  for (const key of batch) {
    const card = cards.get(key);
    assert.ok(card, key);
    assert.equal(card.base_rarity, 4, key);
    assert.equal(card.fragments_required, 0, key);
    const entry = descriptions[key];
    assert.ok(entry, key);
    assert.match(
      entry.source,
      /^https:\/\/opendata\.paris\.fr\/.*refine\.id=\d+$/,
      key,
    );
    assert.ok(entry.source_record_id, key);
    assert.equal(entry.reviewed_at, "2026-10-15", key);
    assert.match(entry.text, /rend hommage (?:à|au) /, key);
    assert.doesNotMatch(
      entry.text,
      /rend hommage (?:à|au) (?:Voisinage|Famille de)/,
      key,
    );
    assert.equal(card.description_full, entry.text, key);
  }
});
