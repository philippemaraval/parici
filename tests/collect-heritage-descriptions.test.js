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
    street: 5711,
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
    5943,
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
  const unlisted = {
    ...catalog.records[0],
    source_entity_id: "Voie test sans notice",
    album_slugs: [],
  };
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

test("the second epic batch adds 1000 distinct cards and preserves the first batch", () => {
  const first = require("./fixtures/collect-heritage-epic-20261015.json");
  const second = require("./fixtures/collect-heritage-epic-20261015-lot2.json");
  const firstSet = new Set(first);
  const sourceIds = new Set(
    first.map((key) => descriptions[key].source_record_id),
  );
  const cards = new Map(
    catalog.records.map((card) => [
      card.family + ":" + card.source_entity_id,
      card,
    ]),
  );
  assert.equal(second.length, 1000);
  assert.equal(new Set(second).size, 1000);
  for (const key of second) {
    assert.ok(!firstSet.has(key), key);
    const card = cards.get(key),
      entry = descriptions[key];
    assert.equal(card.base_rarity, 4, key);
    assert.equal(card.fragments_required, 0, key);
    assert.ok(!sourceIds.has(entry.source_record_id), key);
    sourceIds.add(entry.source_record_id);
    assert.equal(card.description_full, entry.text, key);
    assert.match(
      entry.source,
      /^https:\/\/opendata\.paris\.fr\/.*refine\.id=\d+$/,
      key,
    );
    assert.doesNotMatch(
      entry.text,
      /rend hommage (?:à|au) (?:Voisinage|Famille|Ouverte|Substitué)|\), (?:il |elle |a |fut )|héros|héroïne/,
      key,
    );
  }
  assert.equal(sourceIds.size, 2000);
});

test("the third epic batch adds 2000 sourced cards without reusing previous cards or municipal records", () => {
  const previous = [
    ...require("./fixtures/collect-heritage-epic-20261015.json"),
    ...require("./fixtures/collect-heritage-epic-20261015-lot2.json"),
  ];
  const batch = require("./fixtures/collect-heritage-epic-20261015-lot3.json");
  const previousKeys = new Set(previous);
  const sourceIds = new Set(
    previous.map((key) => descriptions[key].source_record_id),
  );
  const cards = new Map(
    catalog.records.map((card) => [
      card.family + ":" + card.source_entity_id,
      card,
    ]),
  );
  assert.equal(batch.length, 2000);
  assert.equal(new Set(batch).size, 2000);
  for (const key of batch) {
    assert.ok(!previousKeys.has(key), key);
    const card = cards.get(key),
      entry = descriptions[key];
    assert.equal(card.base_rarity, 4, key);
    assert.equal(card.fragments_required, 0, key);
    assert.ok(entry, key);
    assert.ok(!sourceIds.has(entry.source_record_id), key);
    sourceIds.add(entry.source_record_id);
    assert.equal(card.description_full, entry.text, key);
    assert.match(
      entry.source,
      /^https:\/\/opendata\.paris\.fr\/.*refine\.id=\d+$/,
      key,
    );
    assert.equal(entry.license, "ODbL 1.0", key);
    assert.doesNotMatch(
      entry.text,
      /rappelle (?:Appel|Anciennement|Principale|Communication|Dû|Ainsi|Longe|Débouch|Hommage|Substitué|Donné|Origine|Forme|Sans|Probablement|Tiré|Contigu|Famille|Bord|Cette|Ce |On |Il |nom |en |à )/,
      key,
    );
  }
  assert.equal(sourceIds.size, 4000);
});

test("all remaining epic cards and every catalogue card now have a sourced description", () => {
  const batch = require("./fixtures/collect-heritage-epic-20261015-final.json");
  assert.equal(batch.length, 1291);
  assert.equal(new Set(batch).size, 1291);
  for (const card of catalog.records) {
    assert.ok(descriptions[card.family + ":" + card.source_entity_id]);
  }
  const {
    descriptionCoverage,
  } = require("../backend/domains/collect/description-coverage");
  assert.deepEqual(descriptionCoverage(catalog, descriptions), {
    documentedDescriptions: 5943,
    heritageDescriptions: 5369,
    geographicDescriptions: 574,
  });
  assert.equal(
    catalog.records.filter(
      (card) => card.base_rarity === 4 && !card.fragments_required,
    ).length,
    5291,
  );
});

test("geographic notices cite their own OSM objects and only genuine shared vertices", () => {
  const fs = require("node:fs");
  const features =
    require("../backend/domains/collect/map-data").prepareStreetMap(
      JSON.parse(
        fs.readFileSync(
          require("node:path").join(
            __dirname,
            "../data/paris_rues_light.geojson",
          ),
          "utf8",
        ),
      ),
      require("../backend/data/streets_index.json"),
    ).features;
  const byEntity = new Map();
  function vertices(value, output = new Set()) {
    if (typeof value[0] === "number") output.add(JSON.stringify(value));
    else for (const child of value) vertices(child, output);
    return output;
  }
  for (const feature of features) {
    const entity = feature.properties.collect_entity_id;
    const group = byEntity.get(entity) || { ids: new Set(), points: new Set() };
    group.ids.add(feature.properties.osm_id || feature.properties.id);
    for (const point of vertices(feature.geometry.coordinates))
      group.points.add(point);
    byEntity.set(entity, group);
  }
  for (const [key, entry] of Object.entries(descriptions)) {
    if (entry.description_kind !== "geographic") continue;
    const group = byEntity.get(key.slice("street:".length));
    assert.ok(group, key);
    for (const id of entry.source_osm_ids)
      assert.ok(group.ids.has(id), key + ": " + id);
    assert.ok(entry.sources.includes(entry.source), key);
    for (const name of entry.geographic_evidence.neighbors) {
      const neighbor = byEntity.get(name);
      assert.ok(
        neighbor &&
          [...neighbor.points].some((point) => group.points.has(point)),
        key + ": " + name,
      );
      assert.ok(entry.text.includes(name), key);
    }
    const changed = {
      [key]: { ...entry, source: "https://www.openstreetmap.org/copyright" },
    };
    assert.ok(
      validateHeritageDescriptions(
        {
          records: [
            catalog.records.find(
              (card) => card.family + ":" + card.source_entity_id === key,
            ),
          ],
        },
        changed,
      ).length,
    );
  }
});
