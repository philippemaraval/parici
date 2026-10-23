const test = require("node:test"),
  assert = require("node:assert/strict"),
  http = require("node:http");
const { createTestDatabase } = require("./test-database");
test(
  "Daily publication is atomic and Daily unsubscribe preserves the Collect channel",
  { skip: !process.env.TEST_DATABASE_URL, timeout: 180000 },
  async (t) => {
    const isolated = await createTestDatabase(
      process.env.TEST_DATABASE_URL,
      "parici_daily_safety",
    );
    process.env.DATABASE_URL = isolated.url;
    process.env.NODE_ENV = "test";
    process.env.SECRET_KEY = "daily-safety-isolated-test-secret-long-enough";
    const db = require("../../backend/database");
    const { app, initializeDatabase } = require("../../backend/server");
    const server = http.createServer(app);
    t.after(async () => {
      if (server.listening)
        await new Promise((resolve) => server.close(resolve));
      await db.pool.end();
      await isolated.cleanup();
    });
    await initializeDatabase({ startBackgroundServices: false });
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      const catalog = require("../../data/collect_paris_catalog.json");
      const sample = {
        ...catalog.records.find(
          (r) => r.family === "street" && !r.fragments_required,
        ),
        source_entity_id: "pending-editorial-local-test",
        name: "Pending editorial test",
        collection_number: 900000,
        editorial_status: "pending",
        fragments_required: 0,
        questions: [],
      };
      const {
        syncCatalog,
      } = require("../../backend/domains/collect/catalog-sync");
      await syncCatalog(client, {
        ...catalog,
        records: [...catalog.records, sample],
      });
      assert.equal(
        (
          await client.query(
            "SELECT COUNT(*)::int AS n FROM cards WHERE source_entity_id=$1",
            [sample.source_entity_id],
          )
        ).rows[0].n,
        0,
      );
      const reviewed = { ...sample };
      delete reviewed.editorial_status;
      await syncCatalog(client, {
        ...catalog,
        records: [...catalog.records, reviewed],
      });
      const published = (
        await client.query(
          "SELECT collection_number,catalog_present FROM cards WHERE source_entity_id=$1",
          [sample.source_entity_id],
        )
      ).rows[0];
      assert.deepEqual(published, {
        collection_number: 900000,
        catalog_present: true,
      });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
    await Promise.all([
      db.createDailyTargetIfAbsent(
        "2035-01-01",
        "Passage F/7",
        "1er arrondissement",
        [2.35, 48.86],
        null,
      ),
      db.createDailyTargetIfAbsent(
        "2035-01-01",
        "Rue de Rivoli",
        "4e arrondissement",
        [2.36, 48.85],
        null,
      ),
    ]);
    const original = await db.getDailyTarget("2035-01-01");
    await db.createDailyTargetIfAbsent(
      "2035-01-01",
      "Rue de Bretagne",
      "3e arrondissement",
      [2.37, 48.87],
      null,
    );
    assert.deepEqual(await db.getDailyTarget("2035-01-01"), original);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(base + "/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "daily_safety",
        password: "isolated-test-password",
        recoveryEmail: "daily-safety@example.test",
      }),
    });
    assert.equal(response.status, 200);
    const user = await response.json();
    const dailyResponse = await fetch(base + "/api/daily", {
      headers: { authorization: `Bearer ${user.token}` },
    });
    assert.equal(dailyResponse.status, 200);
    const daily = await dailyResponse.json();
    assert.match(daily.arrondissement, /^\d{1,2}(?:er|e) arrondissement$/);
    assert.ok(daily.quartier);
    assert.notEqual(daily.quartier, daily.arrondissement);
    await db.pool.query(
      "INSERT INTO push_subscriptions(user_id,endpoint,subscription_json,enabled,daily_enabled,collect_enabled) VALUES($1,$2,'{}',TRUE,TRUE,TRUE)",
      [user.id, "https://example.test/shared-push"],
    );
    const off = await fetch(base + "/api/notifications/unsubscribe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authorization: `Bearer ${user.token}`,
      },
      body: JSON.stringify({ endpoint: "https://example.test/shared-push" }),
    });
    assert.equal(off.status, 200);
    assert.equal((await off.json()).keepSubscription, true);
    const state = (
      await db.pool.query(
        "SELECT enabled,daily_enabled,collect_enabled FROM push_subscriptions WHERE user_id=$1",
        [user.id],
      )
    ).rows[0];
    assert.deepEqual(state, {
      enabled: true,
      daily_enabled: false,
      collect_enabled: true,
    });
  },
);
