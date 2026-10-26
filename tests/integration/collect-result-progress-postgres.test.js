const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const crypto = require("node:crypto");
const { createTestDatabase } = require("./test-database");

test(
  "Paris result progression: snapshots, albums, duplicates, fragments, quota and replay",
  {
    skip: !process.env.TEST_DATABASE_URL,
    timeout: 240000,
  },
  async (t) => {
    const isolated = await createTestDatabase(
      process.env.TEST_DATABASE_URL,
      "parici_progress",
    );
    process.env.DATABASE_URL = isolated.url;
    process.env.NODE_ENV = "production";
    process.env.CORS_ALLOWED_ORIGINS = "http://127.0.0.1:4173";
    process.env.SECRET_KEY =
      "parici-progress-local-test-secret-with-32-characters";
    const db = require("../../backend/database");
    const { app, initializeDatabase } = require("../../backend/server");
    const server = http.createServer(app);
    t.after(async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await db.pool.end();
      await isolated.cleanup();
    });
    await initializeDatabase({ startBackgroundServices: false });
    await initializeDatabase({ startBackgroundServices: false });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = "http://127.0.0.1:" + server.address().port;
    async function request(path, user, body, method = body ? "POST" : "GET") {
      const response = await fetch(base + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(user ? { Authorization: "Bearer " + user.token } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return {
        status: response.status,
        body: await response.json(),
        cache: response.headers.get("cache-control"),
      };
    }
    async function register(name) {
      const r = await request("/api/register", null, {
        username: name,
        password: "collect-local-test-password",
        recoveryEmail: name + "@example.test",
      });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      return r.body;
    }
    const user = await register("progress_owner"),
      other = await register("progress_other");
    const query = (sql, values) => db.pool.query(sql, values);
    const cards = (
      await query(
        "SELECT * FROM cards WHERE family='street' AND status='active' AND catalog_present AND NOT fragments_enabled ORDER BY id LIMIT 5",
      )
    ).rows;
    const [first, second, third, canonical, legacy] = cards;
    const total = (
      await query(
        "SELECT COUNT(*)::int AS n FROM cards c WHERE status='active' AND catalog_present AND NOT EXISTS(SELECT 1 FROM collect_card_merges m WHERE m.source_card_id=c.id)",
      )
    ).rows[0].n;
    const personal = (
      await query(
        "INSERT INTO collect_personal_albums(user_id,name) VALUES($1,'Mon objectif'),($2,'Album confidentiel') RETURNING id,user_id",
        [user.id, other.id],
      )
    ).rows;
    const target = personal.find((a) => a.user_id === user.id),
      secret = personal.find((a) => a.user_id === other.id);
    await query(
      "INSERT INTO collect_personal_album_cards(album_id,card_id) VALUES($1,$3),($1,$4),($1,$5),($2,$3)",
      [target.id, secret.id, first.id, second.id, third.id],
    );
    await require("../../backend/domains/collect/player-goals").setAlbumGoal(
      db,
      user.id,
      "personal-" + target.id,
    );
    await query(
      "INSERT INTO albums(slug,name) SELECT 'result-test-'||i,'Petit album '||i FROM generate_series(1,4) i",
    );
    await query(
      "INSERT INTO album_cards(album_id,card_id) SELECT id,$1 FROM albums WHERE slug LIKE 'result-test-%'",
      [first.id],
    );
    await query(
      "INSERT INTO card_copies(user_id,card_id,source) VALUES($1,$2,'weekly')",
      [user.id, second.id],
    );
    async function game(card, owner = user) {
      const id = crypto.randomUUID();
      await query(
        "INSERT INTO collect_games(id,user_id,card_id,max_attempts) VALUES($1,$2,$3,1)",
        [id, owner.id, card.id],
      );
      return id;
    }
    async function answer(id, card, owner = user) {
      const r = await request("/api/collect/games/" + id + "/answer", owner, {
        answerEntityId: card.source_entity_id,
        requestId: crypto.randomUUID(),
      });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      return r.body;
    }
    const id = await game(first),
      result = await answer(id, first);
    assert.equal(result.progress.kind, "new");
    assert.deepEqual(result.progress.collection, {
      before: 1,
      after: 2,
      total,
    });
    assert.equal(result.progress.albums.length, 3);
    assert.ok(result.progress.otherAlbumCount >= 3);
    assert.equal(result.progress.albums[0].slug, "personal-" + target.id);
    assert.equal(result.progress.albums[0].targeted, true);
    assert.deepEqual(
      [
        result.progress.albums[0].before,
        result.progress.albums[0].after,
        result.progress.albums[0].total,
        result.progress.albums[0].complete,
      ],
      [1, 2, 3, false],
    );
    assert.ok(
      result.progress.albums
        .slice(1)
        .every((a) => a.complete && a.before === 0 && a.after === 1),
    );
    assert.ok(!JSON.stringify(result.progress).includes("confidentiel"));
    assert.ok(
      result.newBadges.some((b) => b.slug.startsWith("album-result-test-")),
    );
    assert.deepEqual(
      (await query("SELECT result_json FROM collect_games WHERE id=$1", [id]))
        .rows[0].result_json.progress,
      result.progress,
    );
    await query(
      "INSERT INTO card_copies(user_id,card_id,source) VALUES($1,$2,'weekly')",
      [user.id, third.id],
    );
    const replay = await answer(id, first);
    assert.deepEqual(
      replay.progress,
      result.progress,
      "replaying a stored result never recalculates its snapshot",
    );
    const duplicate = await answer(await game(first), first);
    assert.equal(duplicate.progress.kind, "duplicate");
    assert.deepEqual(duplicate.progress.albums, []);
    assert.deepEqual(duplicate.progress.collection, {
      before: 3,
      after: 3,
      total,
    });
    const wrong = await answer(await game(first), second);
    assert.equal(wrong.correct, false);
    assert.equal(wrong.rewardGranted, false);
    assert.equal(wrong.progress, null);
    const legendary = (
      await query(
        "SELECT c.* FROM cards c WHERE status='active' AND catalog_present AND fragments_enabled AND fragments_required>1 AND EXISTS(SELECT 1 FROM collect_questions q WHERE q.card_id=c.id) ORDER BY id LIMIT 1",
      )
    ).rows[0];
    const legendaryAlbum = (
      await query(
        "INSERT INTO collect_personal_albums(user_id,name) VALUES($1,'Carte légendaire') RETURNING id",
        [user.id],
      )
    ).rows[0];
    await query(
      "INSERT INTO collect_personal_album_cards(album_id,card_id) VALUES($1,$2)",
      [legendaryAlbum.id, legendary.id],
    );
    await require("../../backend/domains/collect/player-goals").setAlbumGoal(
      db,
      user.id,
      "personal-" + legendaryAlbum.id,
    );
    async function question() {
      const questionId = await game(legendary),
        placement = await answer(questionId, legendary);
      assert.equal(placement.stage, "question");
      const snapshot = (
        await query("SELECT question_snapshot FROM collect_games WHERE id=$1", [
          questionId,
        ])
      ).rows[0].question_snapshot;
      const r = await request(
        "/api/collect/games/" + questionId + "/question",
        user,
        { answerIndex: snapshot.correct_index },
      );
      assert.equal(r.status, 200, JSON.stringify(r.body));
      return { id: questionId, result: r.body };
    }
    const fragment = await question();
    assert.equal(fragment.result.fragments.earned, 1);
    assert.equal(fragment.result.rewardGranted, false);
    assert.equal(fragment.result.progress, null);
    assert.deepEqual(
      (await answer(fragment.id, legendary)).fragments,
      fragment.result.fragments,
    );
    await query(
      "UPDATE collect_fragment_progress SET fragments=$3 WHERE user_id=$1 AND card_id=$2",
      [user.id, legendary.id, legendary.fragments_required - 1],
    );
    const assembly = await question(),
      assembled = assembly.result;
    assert.equal(assembled.rewardGranted, true);
    assert.equal(assembled.progress.kind, "new");
    assert.equal(
      assembled.progress.albums[0].slug,
      "personal-" + legendaryAlbum.id,
    );
    assert.equal(assembled.progress.albums[0].complete, true);
    assert.equal(assembled.progress.albums[0].targeted, true);
    assert.equal(
      await require("../../backend/domains/collect/player-goals").getAlbumGoal(
        db,
        user.id,
      ),
      null,
    );
    assert.deepEqual(
      (await answer(assembly.id, legendary)).progress,
      assembled.progress,
    );

    assert.equal(assembled.fragments.count, legendary.fragments_required);
    assert.deepEqual(assembled.progress.collection, {
      before: 3,
      after: 4,
      total,
    });
    await answer(await game(first), first); // Four rewarded copies exhaust the normal quota.
    const quota = await answer(await game(first), first);
    assert.equal(quota.correct, true);
    assert.equal(quota.rewardGranted, false);
    assert.equal(quota.rewardBlockedReason, "quota");
    assert.equal(quota.progress, null);
    // Merged copies remain owned: their next canonical copy is a duplicate, not a new card.
    await query(
      "INSERT INTO card_copies(user_id,card_id,source) VALUES($1,$2,'weekly')",
      [other.id, legacy.id],
    );
    await query(
      "INSERT INTO collect_card_merges(source_card_id,canonical_card_id) VALUES($1,$2)",
      [legacy.id, canonical.id],
    );
    await query(
      "UPDATE cards SET status='archived',catalog_present=FALSE WHERE id=$1",
      [legacy.id],
    );
    const merged = await answer(await game(canonical, other), canonical, other);
    assert.equal(merged.progress.kind, "duplicate");
    assert.deepEqual(merged.progress.albums, []);
    assert.deepEqual(merged.progress.collection, {
      before: 1,
      after: 1,
      total: total - 1,
    });
  },
);
