const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

test("daily challenge rolls over at 03:00 local time", () => {
  const source = fs.readFileSync(path.join(ROOT, "backend/server.js"), "utf8");
  const frontendDailySource = fs.readFileSync(path.join(ROOT, "src/daily.js"), "utf8");

  assert.match(
    source,
    /const DAILY_ROLLOVER_HOUR = readEnvIntegerInRange\('DAILY_ROLLOVER_HOUR', 3, 0, 23\);/,
  );
  assert.match(
    source,
    /new Date\(date\.getTime\(\) - DAILY_ROLLOVER_HOUR \* 60 \* 60 \* 1000\)/,
  );
  assert.doesNotMatch(source, /getDateKeyInZone\(DAILY_TIMEZONE\)/);

  assert.match(frontendDailySource, /export const DAILY_STORAGE_TIMEZONE = "Europe\/Paris";/);
  assert.match(frontendDailySource, /export const DAILY_STORAGE_ROLLOVER_HOUR = 3;/);
  assert.match(
    frontendDailySource,
    /validDate\.getTime\(\) - DAILY_STORAGE_ROLLOVER_HOUR \* 60 \* 60 \* 1000/,
  );
});

test("daily target cannot be changed after players started the date", () => {
  const serverSource = fs.readFileSync(path.join(ROOT, "backend/server.js"), "utf8");
  const databaseSource = fs.readFileSync(path.join(ROOT, "backend/database.js"), "utf8");

  assert.match(databaseSource, /async function countDailyUserAttemptsForDate\(date\)/);
  assert.match(serverSource, /countDailyUserAttemptsForDate\(date\)/);
  assert.match(serverSource, /Keeping existing target for \$\{date\}/);
});

test("a Daily started before 03:00 can finish after the rollover", () => {
  const source = fs.readFileSync(path.join(ROOT, "backend/server.js"), "utf8");

  assert.match(source, /async function isDailyGuessDateAllowed/);
  assert.match(source, /shiftIsoDateKey\(expectedDate, -1\)/);
  assert.match(source, /db\.getDailyUserStatus\(userId, submittedDate\)/);
  assert.match(source, /previousStatus\.success !== true/);
  assert.match(source, /Number\(previousStatus\.attempts_count \|\| 0\) < 7/);
  assert.match(
    source,
    /await isDailyGuessDateAllowed\(\s*req\.user\.id,\s*parsed\.value\.date,\s*expectedDate/,
  );
});
