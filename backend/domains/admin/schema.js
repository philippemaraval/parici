"use strict";
const fs = require("node:fs"),
  path = require("node:path");
async function applyAdminSchema(client) {
  const marker = await client.query(
    "SELECT value_text FROM app_settings WHERE key='parici_admin_schema'",
  );
  if (marker.rows[0]?.value_text === "20261013-1") return;
  for (const file of [
    "20261012_admin_operations.sql",
    "20261012_admin_studio.sql",
  ])
    await client.query(
      fs.readFileSync(
        path.resolve(__dirname, "../../../migrations", file),
        "utf8",
      ),
    );
  await client.query(
    "INSERT INTO app_settings(key,value_text) VALUES('parici_admin_schema','20261013-1') ON CONFLICT(key) DO UPDATE SET value_text=EXCLUDED.value_text",
  );
}
module.exports = { applyAdminSchema };
