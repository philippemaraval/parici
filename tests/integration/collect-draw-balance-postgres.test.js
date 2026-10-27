"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { createTestDatabase } = require("./test-database");
const { rarityDrawWeights } = require("../../backend/domains/collect/rules");

test(
  "rarity balance migration upgrades existing databases once and preserves operator settings",
  {
    skip: !process.env.TEST_DATABASE_URL,
    timeout: 30000,
  },
  async (t) => {
    const isolated = await createTestDatabase(
      process.env.TEST_DATABASE_URL,
      "collect_draw_balance",
    );
    const pool = new Pool({ connectionString: isolated.url, ssl: false });
    t.after(async () => {
      await pool.end();
      await isolated.cleanup();
    });
    await pool.query(`
    CREATE TABLE app_settings(key TEXT PRIMARY KEY, value_text TEXT NOT NULL, updated_at TIMESTAMPTZ);
    CREATE TABLE collect_config(key TEXT PRIMARY KEY, value_json JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW());
  `);
    const migration = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../migrations/20261027_collect_rarity_draw_balance.sql",
      ),
      "utf8",
    );
    const read = async () =>
      (
        await pool.query(
          "SELECT value_json FROM collect_config WHERE key='rarity_draw_weights'",
        )
      ).rows[0].value_json;
    const seed = async (config) => {
      await pool.query("TRUNCATE collect_config, app_settings");
      if (config)
        await pool.query(
          "INSERT INTO collect_config(key,value_json) VALUES('rarity_draw_weights',$1)",
          [config],
        );
      await pool.query(
        "INSERT INTO collect_config(key,value_json) VALUES('family_weights',$1)",
        [{ street: 70, district: 10, monument: 10, bus: 10 }],
      );
    };
    for (const [name, before, expected] of [
      ["new installation", null, { 1: 2, 2: 1.5, 3: 1, 4: 0.8, 5: 0.8 }],
      [
        "legacy defaults",
        { 1: 2, 2: 0.75, 3: 1, 4: 0.8, 5: 0.8 },
        { 1: 2, 2: 1.5, 3: 1, 4: 0.8, 5: 0.8 },
      ],
      [
        "custom weights in other rarities",
        { 1: 4, 2: 0.75, 3: 1.2, 4: 0.6, 5: 0.3 },
        { 1: 4, 2: 1.5, 3: 1.2, 4: 0.6, 5: 0.3 },
      ],
      ["custom uncommon weight", { 2: 1.25 }, { 2: 1.25 }],
      ["partial configuration", { 3: 1.1 }, { 3: 1.1 }],
    ]) {
      await t.test(name, async () => {
        await seed(before);
        await pool.query(migration);
        assert.deepEqual(await read(), expected);
        await pool.query(migration);
        assert.deepEqual(await read(), expected);
        assert.equal(
          (
            await pool.query(
              "SELECT COUNT(*)::int AS n FROM app_settings WHERE key='collect_rarity_draw_balance_v1'",
            )
          ).rows[0].n,
          1,
        );
        assert.deepEqual(
          (
            await pool.query(
              "SELECT value_json FROM collect_config WHERE key='family_weights'",
            )
          ).rows[0].value_json,
          { street: 70, district: 10, monument: 10, bus: 10 },
        );
      });
    }
    await t.test("later admin changes survive restart", async () => {
      await seed({ 2: 0.75 });
      await pool.query(migration);
      assert.equal(rarityDrawWeights(await read())[1], 1.5);
      await pool.query(
        "UPDATE collect_config SET value_json=jsonb_set(value_json,'{2}','0.75'::jsonb) WHERE key='rarity_draw_weights'",
      );
      await pool.query(migration);
      assert.equal(rarityDrawWeights(await read())[1], 0.75);
    });
  },
);
