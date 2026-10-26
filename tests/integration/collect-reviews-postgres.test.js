const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const crypto = require("node:crypto");
const { createTestDatabase } = require("./test-database");

test(
  "Paris reviews: owned cards, private albums, errors, replay safety and reward isolation",
  {
    skip: !process.env.TEST_DATABASE_URL,
    timeout: 240000,
  },
  async (t) => {
    const isolated = await createTestDatabase(
      process.env.TEST_DATABASE_URL,
      "parici_review",
    );
    process.env.DATABASE_URL = isolated.url;
    process.env.NODE_ENV = "production";
    process.env.CORS_ALLOWED_ORIGINS = "http://127.0.0.1:4173";
    process.env.SECRET_KEY =
      "parici-review-local-test-secret-with-32-characters";
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
    const user = await register("review_owner"),
      other = await register("review_other");
    const query = (sql, values) => db.pool.query(sql, values);
    const api = (path, body, who = user) =>
      request("/api/collect/reviews" + path, who, body);
    assert.equal((await request("/api/collect/reviews/counts")).status, 401);
    assert.equal((await api("", {})).status, 409);
    assert.equal((await api("", { mode: "unknown" })).status, 400);
    assert.equal((await api("/invalid/next", {})).status, 400);
    assert.equal(
      (await api("/games/invalid/answer", { answerEntityId: "X" })).status,
      400,
    );
    const cards = (
      await query(
        "SELECT * FROM cards WHERE family='street' AND status='active' AND catalog_present AND NOT fragments_enabled ORDER BY id LIMIT 13",
      )
    ).rows;
    const [first, second] = cards;
    for (const card of cards.slice(0, 12))
      await query(
        "INSERT INTO card_copies(user_id,card_id,source) VALUES($1,$2,'weekly')",
        [user.id, card.id],
      );
    const album = (
      await query(
        "INSERT INTO collect_personal_albums(user_id,name) VALUES($1,'À réviser') RETURNING id",
        [user.id],
      )
    ).rows[0];
    await query(
      "INSERT INTO collect_personal_album_cards(album_id,card_id) VALUES($1,$2),($1,$3)",
      [album.id, first.id, cards[12].id],
    );
    const scope = "personal-" + album.id;
    const publicAlbum = (
      await query(
        "INSERT INTO albums(slug,name) VALUES('review-test','Révision Paris') RETURNING id",
      )
    ).rows[0];
    await query(
      "INSERT INTO album_cards(album_id,card_id) VALUES($1,$2),($1,$3)",
      [publicAlbum.id, first.id, second.id],
    );
    async function normalHistory(card, correct, abandoned = false) {
      await query(
        "INSERT INTO collect_games(id,user_id,card_id,finished_at,correct,abandoned) VALUES($1,$2,$3,clock_timestamp(),$4,$5)",
        [crypto.randomUUID(), user.id, card.id, correct, abandoned],
      );
    }
    await normalHistory(first, false);
    await normalHistory(second, false, true);
    let counts = (await api("/counts")).body;
    assert.equal(counts.revision, 12);
    assert.equal(
      counts.errors,
      1,
      "abandoned games never become review errors",
    );
    assert.deepEqual(counts.albums[scope], { revision: 1, errors: 1 });
    assert.deepEqual(counts.albums["review-test"], { revision: 2, errors: 1 });
    assert.equal((await api("", { scope }, other)).status, 404);
    assert.equal(
      (await api("/counts?scope=" + scope, undefined, other)).status,
      404,
    );
    assert.equal((await api("/counts?scope=not-an-album")).status, 404);
    assert.equal(
      (await api("/counts?scope=streets&scope=monuments")).status,
      400,
    );
    const snapshot = async () =>
      (
        await query(`SELECT
    (SELECT COUNT(*) FROM card_copies) AS copies,
    (SELECT COUNT(*) FROM collect_games) AS games,
    (SELECT COUNT(*) FROM collect_attempts) AS attempts,
    (SELECT COUNT(*) FROM collect_fragment_progress) AS fragments,
    (SELECT COUNT(*) FROM collect_question_history) AS questions,
    (SELECT COUNT(*) FROM collect_events) AS events,
    (SELECT COUNT(*) FROM card_rarity_history) AS rarities,
    (SELECT COUNT(*) FROM collect_weekly_rewards) AS weekly,
    (SELECT COUNT(*) FROM user_collect_badges) AS badges`)
      ).rows;
    const before = await snapshot();
    const quotaBefore = await db.getCollectQuota(user.id);
    const start = await api("", { mode: "revision", scope });
    assert.equal(start.status, 200, JSON.stringify(start.body));
    assert.equal(start.cache, "no-store");
    const game = start.body;
    assert.equal(game.card.name, first.name);
    assert.equal(game.review.total, 1);
    assert.equal(game.maxAttempts, 1);
    assert.equal(
      game.card.sourceEntityId,
      undefined,
      "the answer stays hidden until submission",
    );
    assert.equal(
      (await api("", { mode: "revision", scope })).body.gameId,
      game.gameId,
    );
    assert.equal(
      (await api("/" + game.review.sessionId + "/next", {})).body.gameId,
      game.gameId,
    );
    assert.equal(
      (
        await api(
          "/games/" + game.gameId + "/answer",
          { answerEntityId: first.source_entity_id },
          other,
        )
      ).status,
      404,
    );
    assert.equal(
      (await api("/" + game.review.sessionId + "/next", {}, other)).status,
      404,
    );
    const normalAnswer = await request(
      "/api/collect/games/" + game.gameId + "/answer",
      user,
      { answerEntityId: first.source_entity_id },
    );
    assert.equal(
      normalAnswer.status,
      404,
      "a review id cannot enter the reward route",
    );
    assert.equal(
      (await api("/games/" + game.gameId + "/answer", { answerEntityId: "" }))
        .status,
      400,
    );
    const wrong = (
      await api("/games/" + game.gameId + "/answer", {
        answerEntityId: "incorrect",
      })
    ).body;
    assert.equal(wrong.correct, false);
    assert.equal(wrong.card.sourceEntityId, first.source_entity_id);
    assert.equal(wrong.rewardGranted, false);
    assert.equal(wrong.rewardBlockedReason, "review");
    assert.deepEqual(
      (
        await api("/games/" + game.gameId + "/answer", {
          answerEntityId: first.source_entity_id,
        })
      ).body,
      wrong,
    );
    const end = (await api("/" + game.review.sessionId + "/next", {})).body;
    assert.equal(end.complete, true);
    assert.equal(end.review.errors, 1);
    assert.equal(end.review.remainingErrors, 1);
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(await db.getCollectQuota(user.id), quotaBefore);
    assert.deepEqual(
      (await api("/" + game.review.sessionId + "/next", {})).body,
      end,
    );
    // Aliases and their arrondissement context remain accepted, including legendary placement reviews.
    await query(
      "INSERT INTO card_answer_aliases(card_id,answer_entity_id,answer_context) VALUES($1,'review-alias','review-context')",
      [first.id],
    );
    await query(
      "UPDATE cards SET fragments_enabled=TRUE,fragments_required=3 WHERE id=$1",
      [first.id],
    );
    const retry = (await api("", { mode: "errors" })).body;
    assert.equal(retry.card.name, first.name);
    const corrected = (
      await api("/games/" + retry.gameId + "/answer", {
        answerEntityId: "review-alias",
        answerContext: "review-context",
      })
    ).body;
    assert.equal(corrected.correct, true);
    assert.equal(corrected.card.rarity, 5);
    assert.equal(corrected.fragments, undefined);
    assert.equal(corrected.rewardGranted, false);
    assert.equal(
      (await api("/" + retry.review.sessionId + "/next", {})).body.review
        .remainingErrors,
      0,
    );
    assert.equal((await api("/counts")).body.errors, 0);
    assert.equal((await api("", { mode: "errors" })).status, 409);
    assert.deepEqual(await snapshot(), before);
    await normalHistory(first, false);
    assert.equal(
      (await api("/counts")).body.errors,
      1,
      "a later normal failure returns the card to errors",
    );
    // A pending normal game is retained while at most ten distinct owned cards are reviewed.
    const normal = await db.startCollectGame(user.id, () => 0);
    const beforeTen = await snapshot();
    let payload = (await api("", { mode: "revision" })).body;
    assert.equal(payload.review.total, 10);
    assert.notEqual(
      payload.card.name,
      first.name,
      "unseen cards come before a recently reviewed card",
    );
    const ids = new Set(),
      cardIds = new Set();
    while (!payload.complete) {
      ids.add(payload.gameId);
      const answer = (
        await api("/games/" + payload.gameId + "/answer", {
          answerEntityId: "incorrect",
        })
      ).body;
      cardIds.add(answer.card.id);
      payload = (await api("/" + payload.review.sessionId + "/next", {})).body;
    }
    assert.equal(ids.size, 10);
    assert.equal(cardIds.size, 10);
    assert.equal(payload.review.answered, 10);
    assert.equal(payload.review.errors, 10);
    assert.deepEqual(await snapshot(), beforeTen);
    assert.equal(
      (await db.getPendingCollectGame(user.id)).gameId,
      normal.gameId,
    );
    // Ownership or catalogue changes while a session is open prevent answering and allow skipping.
    let unavailable = (await api("", { scope })).body;
    await query("DELETE FROM card_copies WHERE user_id=$1 AND card_id=$2", [
      user.id,
      first.id,
    ]);
    assert.equal(
      (
        await api("/games/" + unavailable.gameId + "/answer", {
          answerEntityId: first.source_entity_id,
        })
      ).status,
      409,
    );
    assert.equal(
      (await api("/" + unavailable.review.sessionId + "/next", {})).body
        .complete,
      true,
    );
    await query(
      "INSERT INTO card_copies(user_id,card_id,source) VALUES($1,$2,'weekly')",
      [user.id, first.id],
    );
    unavailable = (await api("", { scope })).body;
    await query("UPDATE cards SET catalog_present=FALSE WHERE id=$1", [
      first.id,
    ]);
    assert.equal(
      (
        await api("/games/" + unavailable.gameId + "/answer", {
          answerEntityId: first.source_entity_id,
        })
      ).status,
      409,
    );
    assert.equal(
      (await api("/" + unavailable.review.sessionId + "/next", {})).body
        .complete,
      true,
    );
    assert.equal((await api("/counts?scope=" + scope)).body.revision, 0);
  },
);
