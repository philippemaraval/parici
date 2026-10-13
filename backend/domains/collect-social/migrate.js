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
