"use strict";
const { enabled, markMigrated } = require("./service");
async function migrate(pool) {
  if (!enabled()) {
    const marker = await pool.query(
      "SELECT value_text FROM app_settings WHERE key='collect_v2_schema'",
    );
    if (marker.rows[0]?.value_text) markMigrated();
    return;
  }
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(
      "SELECT pg_advisory_xact_lock(hashtext('collect-v2-schema'))",
    );
    const result = await c.query(
      "SELECT value_text FROM app_settings WHERE key='collect_v2_schema'",
    );
    if (result.rows[0]?.value_text !== "20261008-3") {
      throw new Error(
        "Le schéma Collect Paris doit être initialisé avant les échanges.",
      );
    }
    const simple = await c.query(
      "SELECT value_text FROM app_settings WHERE key='collect_simple_trades_schema'",
    );
    if (!simple.rows[0]?.value_text) {
      await c.query(
        require("node:fs").readFileSync(
          require("node:path").resolve(
            __dirname,
            "../../../migrations/20261026_collect_simple_trades.sql",
          ),
          "utf8",
        ),
      );
      await c.query(
        "INSERT INTO app_settings(key,value_text) VALUES('collect_simple_trades_schema','20261026-1') ON CONFLICT(key) DO UPDATE SET value_text=EXCLUDED.value_text",
      );
    }
    await c.query("COMMIT");
    markMigrated();
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
module.exports = { migrate };
