const test = require("node:test");
const assert = require("node:assert/strict");
const source = require("../data/collect_thematic_albums.json").albums;
const catalog = require("../data/collect_paris_catalog.json");
const {
  cardDetails,
  albumDefinitions,
} = require("../backend/domains/collect/catalog-details");
const {
  applyThematicAlbums,
} = require("../backend/domains/collect/thematic-albums");

test("30 Paris themes preserve exact playable memberships and existing albums", () => {
  const albums = albumDefinitions().filter((a) => a.family === "thematic");
  assert.equal(albums.length, 30);
  assert.deepEqual(
    albums.map((a) => a.slug),
    source.map((a) => a.slug),
  );
  const expected = new Map();
  for (const album of source) {
    assert.equal(
      albums.find((a) => a.slug === album.slug).description,
      album.description,
    );
    for (const card of album.cards) {
      const key = card.family + ":" + card.entity;
      if (!expected.has(key)) expected.set(key, []);
      expected.get(key).push(album.slug);
    }
  }
  assert.equal(
    source.reduce((n, a) => n + a.cards.length, 0),
    1310,
  );
  assert.equal(expected.size, 1126);
  const counts = source.map((a) => a.cards.length);
  assert.deepEqual(
    counts,
    [...counts].sort((a, b) => a - b),
  );
  for (const card of catalog.records) {
    const key = card.family + ":" + card.source_entity_id;
    const slugs = cardDetails(card.family, card.source_entity_id).album_slugs;
    assert.ok(
      slugs.includes(
        {
          street: "streets",
          district: "districts",
          monument: "monuments",
          bus: "bus",
        }[card.family],
      ),
    );
    assert.deepEqual(
      slugs.filter((s) => s.startsWith("theme-")).sort(),
      (expected.get(key) || []).sort(),
      key,
    );
    if (expected.has(key)) assert.notEqual(card.editorial_status, "pending");
    expected.delete(key);
  }
  assert.equal(expected.size, 0);
});

test("invalid thematic selections fail before changing any membership", () => {
  const clean = structuredClone(catalog);
  clean.albums = clean.albums.filter((a) => !a.slug.startsWith("theme-"));
  for (const r of clean.records)
    r.album_slugs = r.album_slugs.filter((s) => !s.startsWith("theme-"));
  for (const invalid of [
    {
      ...source[0],
      cards: [{ family: "street", entity: "Unknown test card" }],
    },
    { ...source[0], cards: [source[0].cards[0], source[0].cards[0]] },
    { ...source[0], slug: "streets" },
    { ...source[0], cards: [] },
  ]) {
    const attempt = structuredClone(clean);
    assert.throws(() => applyThematicAlbums(attempt, [source[1], invalid]));
    assert.deepEqual(attempt, clean);
  }
  assert.deepEqual(applyThematicAlbums(clean), catalog);
});
