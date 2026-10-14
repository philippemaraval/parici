const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const fs = require("node:fs");
const path = require("node:path");

test("the production cleanup removes only Test from the 2026-07-22 Daily", () => {
  const migration = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "migrations",
      "20260722_remove_test_daily_attempt.sql",
    ),
    "utf8",
  );
  assert.match(migration, /LOWER\(TRIM\(account\.username\)\) = 'test'/);
  assert.match(migration, /attempt\.date = '2026-07-22'/);
  assert.doesNotMatch(migration, /DELETE FROM users/);
});

test("database startup skips migrations when the schema version is current", async () => {
  const queries = [];
  let released = false;
  const client = {
    async query(sql, params) {
      queries.push({ sql: String(sql).trim(), params });
      if (queries.length === 2) {
        return { rows: [{ app_settings_table: "app_settings" }] };
      }
      if (queries.length === 3) {
        return {
          rows: [{ value_text: "2026-08-24-daily-history-details-v1" }],
        };
      }
      if (String(sql).includes("key='parici_daily_geography_revision'"))
        return {
          rows: [
            {
              value_text:
                require("../backend/domains/game-integrity/daily-geography")
                  .revision,
            },
          ],
        };
      if (String(sql).includes("key='parici_curated_rarity_revision'"))
        return {
          rows: [
            {
              value_text: require("../backend/domains/collect/curated-rarities")
                .revision,
            },
          ],
        };
      if (String(sql).includes("key='parici_collect_sync_revision'"))
        return {
          rows: [
            {
              value_text: JSON.stringify({
                revision:
                  require("../backend/domains/collect/catalog-sync").catalogRevision(),
              }),
            },
          ],
        };
      if (String(sql).includes("key='parici_collect_photo_revision'"))
        return {
          rows: [
            {
              value_text:
                require("../backend/domains/collect/photo-sync").photoRevision(),
            },
          ],
        };
      if (String(sql).includes("key='parici_collect_catalog_revision'"))
        return { rows: [{ value_text: "20261013-2" }] };
      if (String(sql).includes("key='parici_collect_schema'"))
        return { rows: [{ value_text: "20261013-1" }] };
      if (String(sql).includes("key='parici_admin_schema'"))
        return { rows: [{ value_text: "20261013-1" }] };
      return { rows: [] };
    },
    release() {
      released = true;
    },
  };
  const pool = {
    async connect() {
      return client;
    },
  };

  const originalLoad = Module._load;
  Module._load = function mockDependencies(request, parent, isMain) {
    if (request === "pg") {
      return {
        Pool: function Pool() {
          return pool;
        },
      };
    }
    if (request === "bcrypt") {
      return {};
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  let database;
  try {
    const databasePath = require.resolve("../backend/database");
    delete require.cache[databasePath];
    database = require(databasePath);
    await database.initDb();
    delete require.cache[databasePath];
  } finally {
    Module._load = originalLoad;
  }

  assert.equal(queries.filter((q) => q.sql === "COMMIT").length, 1);
  assert.ok(
    !queries.some((q) =>
      /UPDATE cards|INSERT INTO cards|DELETE FROM album_cards/.test(q.sql),
    ),
    "current revisions must not rewrite catalog data",
  );
  assert.match(queries[3].sql, /BEGIN/);
  assert.match(queries[4].sql, /daily_guess_receipts/);
  assert.match(queries[5].sql, /site_notification_reads/);
  assert.match(queries[0].sql, /pg_advisory_lock/);
  assert.match(queries[1].sql, /to_regclass\('public\.app_settings'\)/);
  assert.deepEqual(queries[2].params, ["schema_bootstrap_version"]);
  assert.match(queries.at(-1).sql, /pg_advisory_unlock/);
  assert.equal(released, true);
});
