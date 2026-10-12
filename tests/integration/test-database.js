const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { Pool } = require("pg");
async function createTestDatabase(url, prefix) {
  const connection = new URL(url);
  assert.ok(
    ["localhost", "127.0.0.1", "[::1]"].includes(connection.hostname),
    "Integration tests only accept a local test server",
  );
  const admin = new Pool({ connectionString: url, ssl: false });
  const name = `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  connection.pathname = "/" + name;
  return {
    url: connection.href,
    cleanup: async () => {
      try {
        // Pool.end() can resolve before PostgreSQL has processed every socket
        // close. Never force-kill those connections: the delayed error event
        // would fail an otherwise successful test on faster CI runners.
        for (let attempt = 0; ; attempt++) {
          try {
            await admin.query(`DROP DATABASE "${name}"`);
            break;
          } catch (error) {
            if (error.code !== "55006" || attempt >= 20) throw error;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }
      } finally {
        await admin.end();
      }
    },
  };
}
module.exports = { createTestDatabase };
