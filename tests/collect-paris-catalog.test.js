const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const catalog = require("../data/collect_paris_catalog.json");
test("Paris Collect catalog uses existing identities, complete assets and sourced fragment questions", () => {
  const counts = {},
    identities = new Set(),
    albums = new Set(catalog.albums.map((a) => a.slug));
  for (const card of catalog.records) {
    const key = card.family + ":" + card.source_entity_id;
    assert.ok(!identities.has(key), key);
    identities.add(key);
    counts[card.family] = (counts[card.family] || 0) + 1;
    assert.ok(
      fs.existsSync(path.join(__dirname, "..", card.image_reference)),
      card.image_reference,
    );
    assert.ok(card.description_source.startsWith("https://"));
    assert.ok(card.album_slugs.every((slug) => albums.has(slug)));
    if (card.fragments_required) {
      assert.ok(card.questions.length >= 3);
      for (const q of card.questions) {
        assert.equal(new Set(q.answers).size, 4);
        assert.ok(q.correct_index >= 0 && q.correct_index < 4);
        assert.ok(q.sources.length && q.explanation);
      }
    }
  }
  assert.deepEqual(counts, {
    street: 5711,
    district: 80,
    monument: 107,
    bus: 45,
  });
  assert.ok(albums.has("street-arrondissement-20"));
});
test("Collect and Explorer have no public entry links or release announcement", () => {
  for (const file of fs
    .readdirSync(path.join(__dirname, ".."))
    .filter(
      (f) =>
        f.endsWith(".html") && f !== "collect.html" && f !== "explorer.html",
    )) {
    const html = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    assert.doesNotMatch(
      html,
      /href=["'][^"']*(?:collect|explorer)\.html/i,
      file,
    );
  }
  const menu = fs.readFileSync(
    path.join(__dirname, "../src/public/js/site-menu.js"),
    "utf8",
  );
  assert.doesNotMatch(menu, /href=["'][^"']*(?:collect|explorer)\.html/i);
  const migration = fs.readFileSync(
    path.join(__dirname, "../migrations/20261013_collect_paris.sql"),
    "utf8",
  );
  assert.doesNotMatch(migration, /\b(?:TRUNCATE|DELETE FROM)\b/i);
});
