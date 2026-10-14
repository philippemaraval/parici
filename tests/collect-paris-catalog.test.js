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
    if (card.illustration.kind !== "photograph") {
      assert.equal(card.image_reference, "/apple-touch-icon.png", key);
      assert.equal(card.illustration.source, "parici-logo", key);
    }
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

test("weekly scoring excludes invalid dates and both sides of the weekly boundary",()=>{
 const {calculateResults}=require("../backend/domains/collect/weekly-challenge");
 const rows=calculateResults({starts_at:"2026-10-12T00:00:00Z",ends_at:"2026-10-19T00:00:00Z"},[{id:1,target:2}],[{id:1,username:"Joueur"}],
  ["2026-10-11T23:59:59Z","invalid","2026-10-12T00:00:00Z","2026-10-19T00:00:00Z"].map(first_at=>({user_id:1,objective_id:1,first_at})));
 assert.equal(rows[0].progress[0].current,1);assert.equal(rows[0].score,50);
});

test("public Collect descriptions exclude the question bank and seed gameplay fields",()=>{
 const {cardDetails}=require("../backend/domains/collect/catalog-details");
 const card=catalog.records.find(c=>c.questions.length);const details=cardDetails(card.family,card.source_entity_id);
 assert.ok(details.description_full);for(const key of ['questions','base_rarity','fragments_required','image_reference'])assert.equal(key in details,false);
});
