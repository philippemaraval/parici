const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  validateCatalog,
  validatePlayerContent,
} = require("../scripts/check_player_content");
const catalog = require("../data/collect_paris_catalog.json"),
  index = require("../backend/data/streets_index.json");
test("Paris categories and every scheduled Daily image resolve in the real inventories", () => {
  const result = validatePlayerContent();
  assert.equal(result.famous, 106);
  assert.equal(result.main, 306);
  const broken = {
    ...catalog,
    records: catalog.records.map((c) => ({
      ...c,
      album_slugs: c.album_slugs.filter((s) => s !== "main-streets"),
    })),
  };
  assert.ok(
    validateCatalog(broken, index).some((e) => e.includes("main-streets")),
  );
});
test("street illustrations use observed outlines, not a generic building symbol", () => {
  const fs = require("node:fs"),
    path = require("node:path");
  for (const c of catalog.records.filter(
    (c) => c.family === "street" && c.image_reference.endsWith(".svg"),
  )) {
    const svg = fs.readFileSync(
      path.join(__dirname, "..", c.image_reference),
      "utf8",
    );
    assert.match(svg, /<polyline/, c.name);
    assert.doesNotMatch(svg, /M150 310h140/, c.name);
  }
  const curated = catalog.records.filter(
    (c) => c.family === "monument" && c.fragments_required,
  );
  assert.equal(curated.length, 34);
  for (const c of curated)
    assert.equal(c.questions.length, c.fragments_required);
});
