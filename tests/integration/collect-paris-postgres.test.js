const test = require("node:test"),
  assert = require("node:assert/strict"),
  http = require("node:http"),
  crypto = require("node:crypto"),
  fs = require("node:fs");
const { createTestDatabase } = require("./test-database");
test(
  "Collect Paris: catalog, game receipts, quota, fragments, albums, Daily and browser",
  { skip: !process.env.TEST_DATABASE_URL, timeout: 300000 },
  async (t) => {
    const isolated = await createTestDatabase(
      process.env.TEST_DATABASE_URL,
      "parici_collect",
    );
    process.env.DATABASE_URL = isolated.url;
    process.env.NODE_ENV = "production";
    process.env.CORS_ALLOWED_ORIGINS = "http://127.0.0.1:4173";
    process.env.SECRET_KEY =
      "parici-collect-local-test-secret-with-32-characters";
    const db = require("../../backend/database"),
      { app, initializeDatabase } = require("../../backend/server");
    const server = http.createServer(app);
    let browser;
    t.after(async () => {
      await browser?.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await db.pool.end();
      await isolated.cleanup();
    });
    await initializeDatabase({ startBackgroundServices: false });
    await initializeDatabase({ startBackgroundServices: false });
    await new Promise((resolve) =>
      server.listen(
        process.env.PARICI_COLLECT_BROWSER === "1" ? 4173 : 0,
        "127.0.0.1",
        resolve,
      ),
    );
    const base = "http://127.0.0.1:" + server.address().port;
    async function request(route, user, body, method = body ? "POST" : "GET") {
      const response = await fetch(base + route, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(user ? { Authorization: "Bearer " + user.token } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return {
        status: response.status,
        body: await response.json().catch(() => ({})),
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
    // The photo upgrade updates old seed references but preserves manual artwork,
    // owned copies and the launch gate. Repeated startup leaves the result stable.
    const { photoManifest, applyPhotographs } = require("../../backend/domains/collect/photo-sync");
    const photoEntries = Object.entries(photoManifest()).slice(0, 2);
    const photoCards = [];
    for (const [key, entry] of photoEntries) {
      const split = key.indexOf(":");
      const row = (await db.pool.query("SELECT * FROM cards WHERE family=$1 AND source_entity_id=$2", [key.slice(0,split),key.slice(split+1)])).rows[0];
      assert.equal(row.image_reference, entry.image);
      photoCards.push(row);
    }
    const photoOwner = await register("photo_upgrade_probe");
    const logoCard = (await db.pool.query("SELECT * FROM cards WHERE image_reference='/apple-touch-icon.png' AND image_override IS NULL ORDER BY id LIMIT 1")).rows[0];
    assert.ok(logoCard);
    await db.pool.query("UPDATE cards SET image_reference='/data/collect_images/old-seed.svg' WHERE id=$1", [logoCard.id]);
    await db.pool.query("INSERT INTO card_copies(user_id,card_id,source) VALUES($1,$2,'collect')",[photoOwner.id,photoCards[0].id]);
    await db.pool.query("UPDATE cards SET image_reference='/data/collect_images/old-seed.svg' WHERE id=ANY($1::bigint[])",[photoCards.map(c=>c.id)]);
    await db.pool.query("UPDATE cards SET image_override='/data/manual.jpg',image_credit_override='Crédit manuel' WHERE id=$1",[photoCards[1].id]);
    await db.pool.query("DELETE FROM app_settings WHERE key='parici_collect_photo_revision'");
    const photoClient = await db.pool.connect();
    try {
      await photoClient.query("BEGIN");
      await applyPhotographs(photoClient);
      await applyPhotographs(photoClient);
      await photoClient.query("COMMIT");
    } finally { photoClient.release(); }
    const photoRows=(await db.pool.query("SELECT * FROM cards WHERE id=ANY($1::bigint[]) ORDER BY id",[photoCards.map(c=>c.id)])).rows;
    const automatic=photoRows.find(c=>c.id===photoCards[0].id), manual=photoRows.find(c=>c.id===photoCards[1].id);
    assert.equal(automatic.image_reference,photoEntries[0][1].image);
    assert.equal(manual.image_reference,'/data/collect_images/old-seed.svg');
    assert.equal(manual.image_override,'/data/manual.jpg');
    assert.equal(manual.image_credit_override,'Crédit manuel');
    assert.equal((await db.pool.query("SELECT image_reference FROM cards WHERE id=$1", [logoCard.id])).rows[0].image_reference, '/apple-touch-icon.png');
    assert.equal(Number((await db.pool.query("SELECT COUNT(*) FROM card_copies WHERE user_id=$1",[photoOwner.id])).rows[0].count),1);
    assert.equal((await db.pool.query("SELECT value_text FROM app_settings WHERE key='collect_launch_at'")).rows[0].value_text,'infinity');
    // Restore the probe artwork for the later catalogue/browser assertions.
    await db.pool.query("UPDATE cards SET image_reference=$1,image_override=NULL,image_credit_override=NULL WHERE id=$2",[photoEntries[1][1].image,manual.id]);
    const player = await register("collect_player"),
      other = await register("collect_other");
    assert.equal((await request("/api/collect/quota")).status, 401);
    assert.equal((await request("/api/collect/v2/config")).body.enabled, true);
    const privateDailyPlayer = await register("collect_private_daily");
    const privateDailyTarget = (await request("/api/daily", privateDailyPlayer))
      .body;
    const privateDailyWin = await request(
      "/api/daily/guess",
      privateDailyPlayer,
      {
        date: privateDailyTarget.date,
        answerName:
          privateDailyTarget.displayStreetName || privateDailyTarget.streetName,
        requestId: crypto.randomUUID(),
      },
    );
    assert.equal(privateDailyWin.status, 200);
    assert.equal(privateDailyWin.body.success, true);
    assert.equal(
      Number(
        (
          await db.pool.query(
            "SELECT COUNT(*) FROM card_copies WHERE user_id=$1 AND source='daily'",
            [privateDailyPlayer.id],
          )
        ).rows[0].count,
      ),
      0,
    );
    // Simulate the old catalog: repair memberships and provisional ratings without
    // changing copies, manual corrections, observed ratings or the launch gate.
    const repairPlayer = await register("collect_repair_probe");
    const targets = (
      await db.pool.query(
        "SELECT id FROM cards WHERE family='street' AND base_rarity=4 ORDER BY id LIMIT 3",
      )
    ).rows;
    await db.pool.query(
      "UPDATE cards SET base_rarity=2,current_rarity=2 WHERE id=ANY($1::bigint[])",
      [targets.map((c) => c.id)],
    );
    await db.pool.query(
      "UPDATE cards SET base_rarity_override=3,current_rarity=3,image_override='/data/daily_images/2027-05-07__rue-de-sablonville.jpg' WHERE id=$1",
      [targets[1].id],
    );
    await db.pool.query(
      "UPDATE cards SET rarity_evaluated_at=NOW() WHERE id=$1",
      [targets[2].id],
    );
    await db.pool.query(
      "INSERT INTO card_copies(user_id,card_id,source) VALUES($1,$2,'collect')",
      [repairPlayer.id, targets[0].id],
    );
    await db.pool.query(
      "DELETE FROM album_cards WHERE album_id IN(SELECT id FROM albums WHERE slug IN('famous-streets','main-streets'))",
    );
    await db.pool.query(
      "DELETE FROM app_settings WHERE key='parici_collect_catalog_revision'",
    );
    const correctionClient = await db.pool.connect();
    try {
      await correctionClient.query("BEGIN");
      await require("../../backend/domains/collect/catalog-corrections").applyCatalogCorrections(
        correctionClient,
      );
      await correctionClient.query("COMMIT");
    } finally {
      correctionClient.release();
    }
    const repaired = (
      await db.pool.query(
        "SELECT * FROM cards WHERE id=ANY($1::bigint[]) ORDER BY id",
        [targets.map((c) => c.id)],
      )
    ).rows;
    assert.equal(repaired[0].current_rarity, 4);
    assert.equal(repaired[1].current_rarity, 3);
    assert.equal(repaired[1].base_rarity, 3);
    assert.ok(repaired[1].image_override);
    assert.equal(repaired[2].current_rarity, 2);
    assert.equal(
      Number(
        (
          await db.pool.query(
            "SELECT COUNT(*) FROM card_copies WHERE user_id=$1",
            [repairPlayer.id],
          )
        ).rows[0].count,
      ),
      1,
    );
    assert.equal(await db.getAppSetting("collect_launch_at"), "infinity");
    const categoryCounts = (
      await db.pool.query(
        "SELECT a.slug,COUNT(*)::int AS n FROM albums a JOIN album_cards ac ON ac.album_id=a.id WHERE a.slug IN('famous-streets','main-streets') GROUP BY a.slug",
      )
    ).rows;
    assert.equal(
      categoryCounts.find((a) => a.slug === "famous-streets").n,
      106,
    );
    assert.equal(categoryCounts.find((a) => a.slug === "main-streets").n, 306);
    const hiddenProfile = (await request("/api/profile", player)).body;
    assert.equal(hiddenProfile.collect, undefined);
    assert.equal(hiddenProfile.explorer, undefined);
    assert.ok(
      (await request("/api/site/notifications", player)).body.items.every(
        (i) => !i.key.startsWith("quota:") && !i.key.startsWith("social:"),
      ),
    );
    const healthAdmin = await register("collect_health_admin");
    await db.pool.query("UPDATE users SET role='admin' WHERE id=$1", [
      healthAdmin.id,
    ]);
    const diagnostics = await request(
      "/api/editor/collect/health",
      healthAdmin,
    );
    assert.equal(diagnostics.status, 200, JSON.stringify(diagnostics.body));
    assert.equal(diagnostics.body.geometry.length, 4);
    assert.ok(diagnostics.body.geometry.every((g) => g.missing === 0));
    assert.equal(diagnostics.body.distribution.categories.length, 6);
    const cards = (await db.pool.query("SELECT * FROM cards ORDER BY id")).rows;
    assert.equal(cards.length, 5943);
    assert.deepEqual(
      Object.fromEntries(
        ["street", "district", "monument", "bus"].map((f) => [
          f,
          cards.filter((c) => c.family === f).length,
        ]),
      ),
      { street: 5711, district: 80, monument: 107, bus: 45 },
    );
    for (const family of ["street", "district", "monument", "bus"]) {
      const map = await request("/api/collect/map/" + family);
      assert.equal(map.status, 200);
      assert.ok(map.body.features.length);
      const card = cards.find((c) => c.family === family);
      const image = await fetch(base + card.image_reference);
      assert.equal(image.status, 200, card.image_reference);
    }
    for (const file of [
      "collect_paris_catalog.json",
      "collect_paris_editorial.json",
      "collect_paris_fragments.json",
    ])
      assert.equal((await fetch(base + "/data/" + file)).status, 404);
    const first = await request("/api/collect/games", player, {});
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const resumed = await request("/api/collect/games", player, {});
    assert.equal(resumed.body.gameId, first.body.gameId);
    assert.equal(resumed.body.resumed, true);
    assert.equal(
      (await request("/api/collect/games/pending", other)).body.game,
      null,
    );
    await request(
      "/api/collect/games/" + first.body.gameId,
      player,
      {},
      "DELETE",
    );
    const normal = cards.find((c) => c.family === "monument");
    async function fixtureGame(user, card) {
      const id = crypto.randomUUID();
      await db.pool.query(
        "INSERT INTO collect_games(id,user_id,card_id,max_attempts) VALUES($1,$2,$3,3)",
        [id, user.id, card.id],
      );
      return id;
    }
    async function answer(user, id, card) {
      return request("/api/collect/games/" + id + "/answer", user, {
        answerEntityId: card.source_entity_id,
        requestId: crypto.randomUUID(),
      });
    }
    const id = await fixtureGame(player, normal),
      payload = {
        answerEntityId: normal.source_entity_id,
        requestId: crypto.randomUUID(),
      };
    const wins = await Promise.all([
      request("/api/collect/games/" + id + "/answer", player, payload),
      request("/api/collect/games/" + id + "/answer", player, payload),
    ]);
    wins.forEach((r) => assert.equal(r.status, 200, JSON.stringify(r.body)));
    assert.equal(wins[0].body.rewardGranted, true);
    assert.equal(
      Number(
        (
          await db.pool.query(
            "SELECT COUNT(*) FROM card_copies WHERE user_id=$1",
            [player.id],
          )
        ).rows[0].count,
      ),
      1,
    );
    assert.equal(
      (await request("/api/collect/games/" + id + "/answer", other, payload))
        .status,
      404,
    );
    for (let i = 0; i < 3; i++) {
      const game = await fixtureGame(player, normal);
      assert.equal(
        (await answer(player, game, normal)).body.rewardGranted,
        true,
      );
    }
    assert.equal((await request("/api/collect/quota", player)).body.copies, 4);
    const noReward = await answer(
      player,
      await fixtureGame(player, normal),
      normal,
    );
    assert.equal(noReward.body.correct, true);
    assert.equal(noReward.body.rewardGranted, false);
    assert.equal(
      (await request("/api/collect/notifications", player)).body.full,
      true,
    );
    await db.pool.query(
      "UPDATE collect_awards SET obtained_at=NOW()-INTERVAL '21 minutes' WHERE user_id=$1 AND source='collect'",
      [player.id],
    );
    await db.pool.query(
      "UPDATE collect_quota_notifications SET active_until=NULL, due_at=NOW()-INTERVAL '1 minute' WHERE user_id=$1",
      [player.id],
    );
    assert.equal((await request("/api/health?collect=1")).status, 200);
    let released;
    for (let retry = 0; retry < 30; retry++) {
      released = (
        await db.pool.query(
          "SELECT released_at FROM collect_quota_notifications WHERE user_id=$1",
          [player.id],
        )
      ).rows[0]?.released_at;
      if (released) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(
      released,
      "health collect=1 must process the quota with background services stopped",
    );
    assert.equal(
      (await request("/api/collect/notifications", player)).body.badge,
      true,
    );
    await request("/api/collect/notifications/open", player, {});
    assert.equal(
      (await request("/api/collect/notifications", player)).body.badge,
      false,
    );
    const fragment = cards.find((c) => c.fragments_enabled);
    let questionId;
    for (let i = 0; i < fragment.fragments_required; i++) {
      const game = await fixtureGame(player, fragment),
        placement = await answer(player, game, fragment);
      assert.equal(placement.status, 200, JSON.stringify(placement.body));
      assert.equal(placement.body.stage, "question");
      assert.equal(Object.hasOwn(placement.body, "correct_index"), false);
      const snapshot = (
        await db.pool.query(
          "SELECT question_snapshot FROM collect_games WHERE id=$1",
          [game],
        )
      ).rows[0].question_snapshot;
      questionId = snapshot.id;
      const result = await request(
        "/api/collect/games/" + game + "/question",
        player,
        { answerIndex: snapshot.correct_index },
      );
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(
        result.body.rewardGranted,
        i === fragment.fragments_required - 1,
      );
    }
    assert.ok(questionId);
    assert.equal(
      (
        await db.pool.query(
          "SELECT fragments FROM collect_fragment_progress WHERE user_id=$1 AND card_id=$2",
          [player.id, fragment.id],
        )
      ).rows[0].fragments,
      0, // Completing a card starts the next fragment cycle.
    );
    assert.equal(
      (
        await request(
          "/api/collect/cards/" + normal.id + "/favorite",
          player,
          { favorite: true },
          "PUT",
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await request(
          "/api/collect/collection/page?ownership=favorites",
          player,
        )
      ).body.cards.length,
      1,
    );
    assert.equal(
      (
        await request(
          "/api/collect/collection/page?family=street-arrondissement&arrondissement=20&ownership=all",
          player,
        )
      ).status,
      200,
    );
    const album = await request("/api/collect/personal-albums", player, {
      name: "Paris à retrouver",
    });
    assert.equal(album.status, 201, JSON.stringify(album.body));
    const albumId = album.body.album?.id || album.body.id;
    assert.equal(
      (
        await request(
          "/api/collect/personal-albums/" + albumId + "/cards",
          player,
          { cardIds: [normal.id] },
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await request(
          "/api/collect/personal-albums/" + albumId + "/cards",
          other,
        )
      ).status,
      404,
    );
    const albums = await request("/api/collect/albums", player);
    assert.ok(albums.body.albums.length >= 100);
    assert.ok(albums.body.badges.some((b) => b.earned));
    const goal = albums.body.albums.find((a) =>
      a.slug.startsWith("street-arrondissement-"),
    );
    assert.equal(
      (await request("/api/collect/goal", player, { slug: goal.slug }, "PUT"))
        .body.goal.slug,
      goal.slug,
    );
    const day = "2026-10-13",
      daily = cards.find((c) => c.family === "street" && !c.fragments_enabled);
    await db.pool.query(
      "INSERT INTO daily_targets(date,street_name,arrondissement,coordinates_json) VALUES($1,$2,'Paris',$3) ON CONFLICT(date) DO UPDATE SET street_name=EXCLUDED.street_name",
      [day, daily.source_entity_id, "2.35,48.85"],
    );
    await db.pool.query(
      "INSERT INTO daily_user_attempts(user_id,date,success,attempts_count,last_attempt_at) VALUES($1,$2,TRUE,2,NOW())",
      [other.id, day],
    );
    assert.equal(
      await db.grantDailyCardCopy(other.id, day, daily.source_entity_id, 999),
      null,
    );
    assert.equal(
      Number(
        (
          await db.pool.query(
            "SELECT COUNT(*) FROM card_copies WHERE source='daily'",
          )
        ).rows[0].count,
      ),
      0,
    );
    // Simulate the future public launch; pre-launch wins remain ineligible.
    await db.pool.query(
      "UPDATE app_settings SET value_text=NOW()::text WHERE key='collect_launch_at'",
    );
    assert.ok((await request("/api/profile", player)).body.collect);
    await db.pool.query(
      "INSERT INTO collect_social_notifications(user_id,event_key,kind,payload) VALUES($1,'public-shell-test','friend_request','{}'::jsonb)",
      [player.id],
    );
    const publicInbox = (await request("/api/site/notifications", player)).body;
    assert.ok(publicInbox.items.some((i) => i.key.startsWith("quota:")));
    assert.ok(publicInbox.items.some((i) => i.key.startsWith("social:")));
    assert.equal(
      (
        await request("/api/site/notifications/open", player, {
          keys: publicInbox.keys,
          snapshotAt: publicInbox.snapshotAt,
          socialThrough: publicInbox.socialThrough,
        })
      ).status,
      200,
    );
    assert.ok(
      (await request("/api/site/notifications", player)).body.items
        .filter((i) => i.key.startsWith("social:"))
        .every((i) => !i.unread),
    );
    const publicSettings = (await request("/api/site/settings", player)).body;
    assert.equal(publicSettings.collectPublic, true);
    assert.equal(publicSettings.socialEnabled, true);

    assert.equal(
      await db.grantDailyCardCopy(other.id, day, daily.source_entity_id, 999),
      null,
    );
    await db.pool.query(
      "UPDATE daily_user_attempts SET last_attempt_at=NOW() WHERE user_id=$1 AND date=$2",
      [other.id, day],
    );
    const dailyReward = await db.grantDailyCardCopy(
      other.id,
      day,
      daily.source_entity_id,
      999,
    );
    assert.ok(dailyReward);
    assert.equal(
      await db.grantDailyCardCopy(other.id, day, daily.source_entity_id, 999),
      null,
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT daily_attempt_count FROM card_copies WHERE user_id=$1 AND source='daily'",
          [other.id],
        )
      ).rows[0].daily_attempt_count,
      2,
    );
    assert.equal((await db.getCollectQuota(other.id)).copies, 0);
    await db.pool.query(
      "UPDATE app_settings SET value_text='infinity' WHERE key='collect_launch_at'",
    );
    const weekly = await request("/api/collect/weekly-challenge", player);
    assert.equal(weekly.status, 200, JSON.stringify(weekly.body));
    assert.ok(
      weekly.body.objectives?.length ||
        weekly.body.challenge?.objectives?.length,
    );
    await initializeDatabase({ startBackgroundServices: false });
    assert.equal(
      Number((await db.pool.query("SELECT COUNT(*) FROM cards")).rows[0].count),
      5943,
    );
    assert.ok(
      Number(
        (await db.pool.query("SELECT COUNT(*) FROM card_copies")).rows[0].count,
      ) >= 6,
    );
    const endpoint = "https://push.example.test/parici-collect-test";
    await db.upsertPushSubscription(player.id, {
      endpoint,
      keys: { p256dh: "local-test", auth: "local-test" },
    });
    await db.pool.query(
      "UPDATE push_subscriptions SET collect_enabled=TRUE WHERE endpoint=$1",
      [endpoint],
    );
    assert.equal(
      (await request("/api/notifications/unsubscribe", player, { endpoint }))
        .body.keepSubscription,
      true,
    );
    assert.equal(
      (await db.getPushSubscriptionStatusForUser(player.id)).enabled,
      false,
    );
    assert.equal(
      (await request("/api/collect/push/unsubscribe", player, { endpoint }))
        .body.keepSubscription,
      false,
    );
    await db.upsertPushSubscription(player.id, {
      endpoint,
      keys: { p256dh: "local-test", auth: "local-test" },
    });
    await db.pool.query(
      "UPDATE push_subscriptions SET collect_enabled=TRUE WHERE endpoint=$1",
      [endpoint],
    );
    assert.equal(
      (await request("/api/collect/push/unsubscribe", player, { endpoint }))
        .body.keepSubscription,
      true,
    );
    assert.equal(
      (await db.getPushSubscriptionStatusForUser(player.id)).enabled,
      true,
    );
    if (process.env.PARICI_COLLECT_BROWSER === "1") {
      const { chromium } = require("@playwright/test");
      browser = await chromium.launch({ channel: "chrome", headless: true });
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        serviceWorkers: "block",
      });
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (e) => {
        errors.push(e.message);
        console.log("PAGEERROR", e.message);
      });
      page.on("requestfailed", (r) =>
        console.log("REQUESTFAILED", r.url(), r.failure()),
      );
      page.on("response", (r) => {
        if (r.status() >= 400) console.log("HTTPERROR", r.status(), r.url());
      });
      page.on("console", (message) => {
        if (message.type() === "error") console.log("BROWSER", message.text());
      });
      await page.route("**/src/public/js/runtime-config.js", (route) =>
        route.fulfill({
          contentType: "application/javascript",
          body:
            "window.CaminoRuntimeConfig=Object.freeze({apiUrl:" +
            JSON.stringify(base) +
            "});",
        }),
      );
      await page.addInitScript((user) => {
        localStorage.setItem("camino_auth_token", user.token);
        localStorage.setItem(
          "camino_paris_user",
          JSON.stringify({ ...user, authenticated: true }),
        );
      }, player);
      page.setDefaultTimeout(15000);
      fs.mkdirSync("/tmp/parici-collect-review", { recursive: true });
      async function selectArtwork(card) {
        const response = page.waitForResponse((r) => {
          const url = new URL(r.url());
          return url.pathname === '/api/collect/collection/page' &&
            url.searchParams.get('family') === card.family &&
            url.searchParams.get('search') === card.name;
        });
        await page.locator('#collect-filter-family').selectOption(card.family);
        await page.locator('#collect-search').fill(card.name);
        await (await response).finished();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      }
      const photographSamples = ["Place Georges Pompidou", "Rue de la Mire", "Opéra Bastille", "Bonne-Nouvelle"].map(name => cards.find(c => c.name === name && c.image_reference.includes('/photo-')));
      assert.ok(photographSamples.every(Boolean));
      for (const card of photographSamples) {
        await db.pool.query("INSERT INTO card_copies(user_id,card_id,source) VALUES($1,$2,'weekly')",[player.id,card.id]);
      }
      const wikimediaSamples = ["Métro 1", "Panthéon", "Colonne Vendôme", "Rue Crémieux"].map(name => cards.find(c => c.name === name && c.image_reference.includes('/wikimedia-')));
      assert.ok(wikimediaSamples.every(Boolean));
      for (const card of wikimediaSamples) {
        await db.pool.query("INSERT INTO card_copies(user_id,card_id,source) VALUES($1,$2,'weekly')",[player.id,card.id]);
      }
      const logoSample = cards.find(c => c.name === 'Allée 39/45' && c.image_reference === '/apple-touch-icon.png');
      assert.ok(logoSample);
      await db.pool.query("INSERT INTO card_copies(user_id,card_id,source) VALUES($1,$2,'weekly')",[player.id,logoSample.id]);
      await page.goto(base + "/collect.html?panel=collection", {waitUntil: "domcontentloaded"});
      for (const width of [390, 1440]) {
        await page.setViewportSize({width,height:900});
        for (const card of photographSamples) {
          await selectArtwork(card);
          const tile=page.locator(`.collect-card[data-card-id="${card.id}"]`);
          await tile.waitFor({state:'visible'});
          await tile.scrollIntoViewIfNeeded();
          const photo=tile.locator('.collect-card-art>img');
          await photo.evaluate(img=>{img.loading="eager";return img.decode();});
          assert.ok((await photo.getAttribute('src')).includes('/photo-'));
          assert.equal(await tile.locator('.collect-card-photo-credit').innerText(),'Google Street View');
          if(card.family==='monument')assert.equal(await photo.evaluate(img=>getComputedStyle(img).objectFit),'contain');
          await tile.screenshot({path:`/tmp/parici-collect-review/photo-${card.family}-${card.id}-${width}.png`});
        }
        for (const card of wikimediaSamples) {
          await selectArtwork(card);
          const tile = page.locator(`.collect-card[data-card-id="${card.id}"]`);
          await tile.waitFor({state:'visible'});
          await tile.scrollIntoViewIfNeeded();
          const photo = tile.locator('.collect-card-art>img');
          await photo.evaluate(img => {img.loading="eager";return img.decode();});
          assert.ok((await photo.getAttribute('src')).includes('/wikimedia-'));
          assert.match(await tile.locator('.collect-card-photo-credit').innerText(), /Wikimedia/);
          if (card.family !== 'street') assert.equal(await photo.evaluate(img => getComputedStyle(img).objectFit), 'contain');
          await tile.screenshot({path:`/tmp/parici-collect-review/wikimedia-${card.family}-${card.id}-${width}.png`});
        }
        await selectArtwork(logoSample);
        const logoTile = page.locator(`.collect-card[data-card-id="${logoSample.id}"]`);
        await logoTile.waitFor({state:'visible'});
        await logoTile.scrollIntoViewIfNeeded();
        const logoImage = logoTile.locator('.collect-card-art--logo>img');
        await logoImage.evaluate(img => img.decode());
        assert.equal(await logoImage.getAttribute('src'), '/apple-touch-icon.png');
        assert.equal(await logoImage.evaluate(img => getComputedStyle(img).objectFit), 'contain');
        await logoTile.screenshot({path:`/tmp/parici-collect-review/logo-${logoSample.family}-${width}.png`});
      }
      await page.setViewportSize({width:390,height:844});
      await page.goto(base + "/collect.html");
      await page
        .locator("#collect-next")
        .waitFor({ state: "visible" })
        .catch(async (e) => {
          await page.screenshot({
            path: "/tmp/parici-collect-review/error.png",
            fullPage: true,
          });
          console.log("PAGEBODY", await page.locator("body").innerText());
          throw e;
        });
      await page.screenshot({
        path: "/tmp/parici-collect-review/play-mobile.png",
        fullPage: true,
      });
      assert.equal(
        await page
          .locator(
            'nav.site-nav a[href*="collect.html"],nav.site-nav a[href*="explorer.html"],.site-drawer-links a[href*="collect.html"],.site-drawer-links a[href*="explorer.html"]',
          )
          .count(),
        0,
      );
      assert.equal(await page.locator(".site-header").count(), 1);
      await page.screenshot({
        path: "/tmp/parici-collect-review/play-viewport.png",
      });
      await page.locator("#collect-next").click();
      await page.locator("body.collect-session-active").waitFor();
      assert.equal(await page.locator("nav.site-nav").isVisible(), false);
      assert.equal(
        await page.locator("#collect-weekly-play").isVisible(),
        false,
      );
      await page.screenshot({
        path: "/tmp/parici-collect-review/game-mobile.png",
        fullPage: true,
      });
      await page.reload();
      await page.locator("#collect-next").waitFor({ state: "visible" });
      await page.locator("#collect-next").click();
      await page.locator("body.collect-session-active").waitFor();
      await page.locator("#collect-exit").click();
      await page.locator("nav.site-nav").waitFor({ state: "visible" });
      await page.locator('[data-panel="collection"]').click();
      await page.locator(".collect-tile").first().waitFor();
      await page.screenshot({
        path: "/tmp/parici-collect-review/collection-mobile.png",
        fullPage: true,
      });
      await page.locator('[data-panel="community"]').click();
      await page
        .locator('[data-community-tab="social"]')
        .waitFor({ state: "visible" });
      await page
        .locator("#collect-settings")
        .evaluate((el) => (el.open = true));
      await page
        .locator('#collect-settings-form select[name="visibility"]')
        .selectOption("private");
      await page.locator("#collect-settings-form button").click();
      await page
        .locator("#collect-settings-status")
        .filter({ hasText: "Réglages enregistrés" })
        .waitFor();
      assert.equal(
        (await request("/api/collect/profiles/" + player.username, other))
          .status,
        404,
      );
      await page.locator('[data-community-tab="social"]').click();
      await page.screenshot({
        path: "/tmp/parici-collect-review/social-mobile.png",
        fullPage: true,
      });
      for (const width of [320, 390, 430, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth + 1,
          ),
          false,
          "Collect overflow " + width,
        );
      }
      await page.goto(base + "/?view=home");
      assert.equal(
        await page
          .locator('a[href*="collect.html"],a[href*="explorer.html"]')
          .count(),
        0,
      );
      assert.deepEqual(errors, []);
    }
  },
);
