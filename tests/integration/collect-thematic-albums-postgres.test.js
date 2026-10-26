const test = require("node:test");
const assert = require("node:assert/strict");
const source = require("../../data/collect_thematic_albums.json").albums;
const url = process.env.TEST_DATABASE_URL;

test(
  "Paris themes retain progression, goals, reviews and badges across catalog sync",
  { skip: !url, timeout: 180000 },
  async (t) => {
    const isolated = await require("./test-database").createTestDatabase(
      url,
      "parici_themes",
    );
    process.env.DATABASE_URL = isolated.url;
    process.env.NODE_ENV = "production";
    const db = require("../../backend/database");
    t.after(async () => {
      await db.pool.end();
      await isolated.cleanup();
    });
    await db.initDb();
    Object.assign(db, require("../../backend/collect-database"));
    const q = (sql, args) => db.pool.query(sql, args);
    await q(
      "INSERT INTO users(id,username,password_hash) VALUES(1,'thematic_owner','local-test-hash')",
    );
    const albums = (await db.getCollectAlbums(1)).filter((a) =>
      a.slug.startsWith("theme-"),
    );
    assert.equal(albums.length, 30);
    assert.equal(
      albums.reduce((sum, a) => sum + a.active_card_count, 0),
      883,
    );
    for (const album of source) {
      const row = albums.find((a) => a.slug === album.slug);
      assert.equal(row.active_card_count, album.cards.length);
      assert.equal(row.name, album.name);
      assert.equal(row.description, album.description);
    }
    const theme = source[0];
    const members = await db.getCollectAlbumCards(1, theme.slug);
    await q(
      "INSERT INTO card_copies(user_id,card_id,source) VALUES(1,$1,'weekly')",
      [members[0].id],
    );
    const goals = require("../../backend/domains/collect/player-goals");
    const reviews = require("../../backend/domains/collect/reviews");
    const goal = await goals.setAlbumGoal(db, 1, theme.slug);
    assert.equal(goal.remaining, members.length - 1);
    assert.equal((await reviews.counts(db, 1, theme.slug)).revision, 1);
    const review = await reviews.start(db, 1, { scope: theme.slug });
    assert.equal(review.review.total, 1);
    const answer = (
      await q("SELECT source_entity_id FROM cards WHERE id=$1", [members[0].id])
    ).rows[0].source_entity_id;
    assert.equal(
      (await reviews.answer(db, 1, review.gameId, answer)).rewardGranted,
      false,
    );
    const catalog = structuredClone(
      require("../../data/collect_paris_catalog.json"),
    );
    const {
      syncCatalog,
      catalogRevision,
    } = require("../../backend/domains/collect/catalog-sync");
    const before = catalogRevision(catalog);
    catalog.albums.find((a) => a.slug === theme.slug).description +=
      " Mise à jour de test.";
    assert.notEqual(catalogRevision(catalog), before);
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      await syncCatalog(client, catalog);
      await syncCatalog(client, catalog);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    const after = (await db.getCollectAlbums(1)).filter((a) =>
      a.slug.startsWith("theme-"),
    );
    assert.deepEqual(
      after.map((a) => a.id),
      albums.map((a) => a.id),
    );
    assert.equal(after[0].owned_active_card_count, 1);
    assert.equal(
      after[0].description,
      catalog.albums.find((a) => a.slug === theme.slug).description,
    );
    assert.equal(
      (await goals.getAlbumGoal(db, 1)).remaining,
      members.length - 1,
    );
    await q(
      "INSERT INTO card_copies(user_id,card_id,source) SELECT 1,unnest($1::bigint[]),'weekly'",
      [members.slice(1).map((c) => c.id)],
    );
    await db.awardCollectBadges(1);
    assert.ok(
      (await db.getCollectBadges(1)).find(
        (b) => b.slug === "album-" + theme.slug,
      ).earned,
    );
    assert.equal(await goals.getAlbumGoal(db, 1), null);
  },
);
