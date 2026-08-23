const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const ROOT = path.resolve(__dirname, "..");

test("Daily guess sync preserves the complete local attempt count", () => {
  const app = fs.readFileSync(path.join(ROOT, "src/app.js"), "utf8");
  const server = fs.readFileSync(path.join(ROOT, "backend/server.js"), "utf8");
  const database = fs.readFileSync(path.join(ROOT, "backend/database.js"), "utf8");

  assert.match(app, /attemptsCount: u/);
  assert.match(server, /Invalid attemptsCount value/);
  assert.match(server, /parsed\.value\.attemptsCount/);
  assert.match(
    database,
    /WHEN \$5::integer IS NULL[\s\S]*COALESCE\(daily_user_attempts\.attempts_count, 0\) \+ 1/,
  );
  assert.match(
    database,
    /GREATEST\(\s*COALESCE\(daily_user_attempts\.attempts_count, 0\),\s*EXCLUDED\.attempts_count/,
  );
  assert.match(app, /DAILY_GUESS_SYNC_RETRY_DELAYS_MS = \[1000, 3000, 10000\]/);
  assert.match(app, /submitDailyGuessToServer\(payload, retryIndex \+ 1\)/);
  assert.match(app, /recoveredSuccess[\s\S]*submitDailyGuessToServer\(/);
});
