const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const {
  createDailyLocationResolver,
} = require("../backend/domains/game-integrity/daily-location");
const quarters = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../data/paris_quartiers.geojson"),
    "utf8",
  ),
);
const index = require("../backend/data/streets_index.json");
const resolve = createDailyLocationResolver(quarters);
test("every actual Paris quarter resolves separately from its arrondissement", () => {
  for (const { properties: p } of quarters.features) {
    const actual = resolve("Quartier " + p.l_qu);
    assert.equal(
      actual.arrondissement,
      `${p.c_ar}${Number(p.c_ar) === 1 ? "er" : "e"} arrondissement`,
      p.l_qu,
    );
    assert.equal(actual.quartier, p.l_qu);
  }
});
test("both legacy Daily geographic formats yield the same two distinct hints", () => {
  for (const street of index) {
    const original = resolve(street.arrondissement, street);
    assert.ok(original.arrondissement, street.name);
    assert.ok(original.quartier, street.name);
    assert.deepEqual(
      resolve(original.arrondissement, street),
      original,
      street.name,
    );
  }
  assert.deepEqual(
    resolve("5e arrondissement", { quartier: "Quartier de Bercy" }),
    { arrondissement: "5e arrondissement", quartier: null },
  );
});
test("every scheduled Daily can provide an arrondissement and a quarter without editing its target", () => {
  const csv = fs.readFileSync(
    path.join(__dirname, "../data/daily_images/manifest_next_30.csv"),
    "utf8",
  );
  const rows = require("../scripts/check_player_content").parseCsv(csv);
  const [headers, ...data] = rows;
  for (const values of data) {
    const row = Object.fromEntries(headers.map((key, i) => [key, values[i]]));
    if (row.date < "2026-10-23") continue;
    const street =
      index.find((s) => s.name === row.street_name) ||
      index.find((s) => s.osmName === row.street_name);
    const actual = resolve(row.arrondissement, street);
    assert.ok(actual.arrondissement, row.date);
    assert.ok(actual.quartier, row.date);
  }
});
