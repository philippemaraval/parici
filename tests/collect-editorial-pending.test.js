const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  validateHeritageDescriptions,
} = require("../scripts/check_player_content");
const catalog = require("../data/collect_paris_catalog.json"),
  descriptions = require("../data/collect_descriptions.json");
test("new map identities may wait for editorial review without weakening published card checks", () => {
  const sample = catalog.records.find(
    (r) => r.family === "street" && !r.fragments_required,
  );
  const pending = {
    ...sample,
    source_entity_id: "new-map-identity",
    editorial_status: "pending",
    questions: [],
    fragments_required: 0,
  };
  assert.deepEqual(
    validateHeritageDescriptions({ records: [pending] }, descriptions),
    [],
  );
  assert.ok(
    validateHeritageDescriptions(
      { records: [{ ...sample, editorial_status: "pending" }] },
      descriptions,
    ).length,
  );
  assert.ok(
    validateHeritageDescriptions(
      { records: [{ ...pending, editorial_status: undefined }] },
      descriptions,
    ).some((e) => e.includes("fiche patrimoniale absente")),
  );
  assert.ok(
    validateHeritageDescriptions(
      { records: [{ ...pending, fragments_required: 2 }] },
      descriptions,
    ).length,
  );
});
