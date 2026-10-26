const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { createTestDatabase } = require("./test-database");

test(
  "Paris album targets: migration, privacy, same-rarity draws and pending games",
  {
    skip: !process.env.TEST_DATABASE_URL,
    timeout: 180000,
  },
  async (t) => {
    const isolated = await createTestDatabase(
      process.env.TEST_DATABASE_URL,
      "parici_target",
    );
    process.env.DATABASE_URL = isolated.url;
    process.env.NODE_ENV = "production";
    process.env.CORS_ALLOWED_ORIGINS = "http://127.0.0.1:4173";
    process.env.SECRET_KEY =
      "parici-album-target-local-test-secret-32-characters";
    const db = require("../../backend/database");
    const { app, initializeDatabase } = require("../../backend/server");
    const goals = require("../../backend/domains/collect/player-goals");
    const server = http.createServer(app);
    t.after(async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await db.pool.end();
      await isolated.cleanup();
    });
    await initializeDatabase({ startBackgroundServices: false });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = "http://127.0.0.1:" + server.address().port;
    async function request(path, user, body, method = "PUT") {
      const response = await fetch(base + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(user ? { Authorization: "Bearer " + user.token } : {}),
        },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    }
    async function register(name) {
      const r = await request(
        "/api/register",
        null,
        {
          username: name,
          password: "collect-local-test-password",
          recoveryEmail: name + "@example.test",
        },
        "POST",
      );
      assert.equal(r.status, 200, JSON.stringify(r.body));
      return r.body;
    }
    const user = await register("target_owner"),
      other = await register("target_other");
    const query = (sql, values) => db.pool.query(sql, values);
    const cards = (
      await query(
        "SELECT * FROM cards WHERE family='street' AND status='active' AND catalog_present AND NOT fragments_enabled ORDER BY id LIMIT 3",
      )
    ).rows;
    const [owned, missing, original] = cards;
    await query(
      "UPDATE cards SET current_rarity=2 WHERE id=ANY($1::bigint[])",
      [cards.map((c) => c.id)],
    );
    for (const card of cards) card.current_rarity = 2;
    const album = (
      await query(
        "INSERT INTO collect_personal_albums(user_id,name) VALUES($1,'Mon objectif') RETURNING id",
        [user.id],
      )
    ).rows[0];
    await query(
      "INSERT INTO collect_personal_album_cards(album_id,card_id) VALUES($1,$2),($1,$3)",
      [album.id, owned.id, missing.id],
    );
    const slug = "personal-" + album.id;
    assert.equal(
      await goals.targetDrawCard(db.pool, user.id, original, () => 0),
      original,
    );
    await query(
      "INSERT INTO card_copies(user_id,card_id,source) VALUES($1,$2,'collect')",
      [user.id, owned.id],
    );
    const publicAlbum = (
      await query(
        "INSERT INTO albums(slug,name) VALUES('target-test','Album test') RETURNING id",
      )
    ).rows[0];
    await query(
      "INSERT INTO album_cards(album_id,card_id) VALUES($1,$2),($1,$3)",
      [publicAlbum.id, owned.id, missing.id],
    );
    await goals.setAlbumGoal(db, user.id, "target-test");
    assert.equal(
      (await request("/api/collect/goal", other, { slug })).status,
      404,
    );
    assert.equal(
      (await request("/api/collect/goal", user, { slug })).status,
      200,
    );
    assert.equal(
      (await request("/api/collect/goal", user, { slug: "not-an-album" }))
        .status,
      404,
    );
    assert.equal((await goals.getAlbumGoal(db, user.id)).slug, slug);
    // Repeated startup runs the idempotent upgrade and preserves an existing goal.
    await initializeDatabase({ startBackgroundServices: false });
    assert.equal((await goals.getAlbumGoal(db, user.id)).slug, slug);
    let targeted = 0;
    for (let i = 0; i < 100; i++) {
      const card = await goals.targetDrawCard(
        db.pool,
        user.id,
        original,
        () => (i + 0.5) / 100,
      );
      if (Number(card.id) === Number(missing.id)) targeted++;
      assert.equal(Number(card.current_rarity), 2);
    }
    assert.equal(targeted, 20);
    assert.equal(
      await goals.targetDrawCard(db.pool, user.id, original, () => 0.2),
      original,
    );
    assert.equal(
      await goals
        .targetDrawCard(
          db.pool,
          user.id,
          { ...original, current_rarity: 4 },
          () => 0,
        )
        .then((c) => c.current_rarity),
      4,
    );
    await query(
      "UPDATE cards SET fragments_enabled=TRUE,fragments_required=3 WHERE id=$1",
      [missing.id],
    );
    assert.equal(
      await goals.targetDrawCard(db.pool, user.id, original, () => 0),
      original,
    );
    assert.equal(
      Number(
        (
          await goals.targetDrawCard(
            db.pool,
            user.id,
            { ...original, fragments_enabled: true },
            () => 0,
          )
        ).id,
      ),
      Number(missing.id),
    );
    await query(
      "UPDATE cards SET fragments_enabled=FALSE,fragments_required=0 WHERE id=$1",
      [missing.id],
    );
    const game = await db.startCollectGame(user.id, () => 0);
    await goals.setAlbumGoal(db, user.id, "target-test");
    assert.equal(
      (await db.startCollectGame(user.id, () => 0.99)).gameId,
      game.gameId,
    );
    await db.abandonCollectGame(user.id, game.gameId);
    await query(
      "INSERT INTO card_copies(user_id,card_id,source) VALUES($1,$2,'collect')",
      [user.id, missing.id],
    );
    assert.equal(await goals.getAlbumGoal(db, user.id), null);
    assert.equal(await goals.getAlbumGoal(db, user.id), null);
    assert.equal(
      (
        await query(
          "SELECT COUNT(*)::int AS n FROM collect_events WHERE user_id=$1 AND kind='album_complete'",
          [user.id],
        )
      ).rows[0].n,
      1,
    );
    await goals.setAlbumGoal(db, user.id, "streets");
    assert.equal(
      (await request("/api/collect/goal", user, { slug })).status,
      409,
    );
    assert.equal((await goals.getAlbumGoal(db, user.id)).slug, "streets");
    await query("DELETE FROM card_copies WHERE user_id=$1 AND card_id=$2", [
      user.id,
      missing.id,
    ]);
    await goals.setAlbumGoal(db, user.id, slug);
    await query("UPDATE cards SET catalog_present=FALSE WHERE id=$1", [
      missing.id,
    ]);
    assert.equal(await goals.getAlbumGoal(db, user.id), null);
    await query("UPDATE cards SET catalog_present=TRUE WHERE id=$1", [
      missing.id,
    ]);
    await goals.setAlbumGoal(db, user.id, slug);
    await query("DELETE FROM collect_personal_albums WHERE id=$1", [album.id]);
    assert.equal(await goals.getAlbumGoal(db, user.id), null);
    await goals.setAlbumGoal(db, user.id, "streets");
    assert.equal(
      (await request("/api/collect/goal", user, { slug: "" })).status,
      200,
    );
    assert.equal(await goals.getAlbumGoal(db, user.id), null);
  },
);
