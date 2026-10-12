const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const ROOT = path.resolve(__dirname, "..");

test("Daily sync sends the selected place and an idempotent receipt instead of a score", () => {
  const app = fs.readFileSync(path.join(ROOT, "src/app.js"), "utf8");
  assert.match(app,/answerName: e.properties.name/);
  assert.match(app,/requestId: dailyGuessHistory.at\(-1\).requestId/);
  assert.match(app,/DAILY_GUESS_SYNC_RETRY_DELAYS_MS = \[1000, 3000, 10000\]/);
  assert.match(app,/dailyGuessHistory.slice\(serverAttempts\)/);
});
