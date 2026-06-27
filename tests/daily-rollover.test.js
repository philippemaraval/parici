const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

test("daily challenge rolls over at 03:00 local time", () => {
  const source = fs.readFileSync(path.join(ROOT, "backend/server.js"), "utf8");

  assert.match(
    source,
    /const DAILY_ROLLOVER_HOUR = readEnvIntegerInRange\('DAILY_ROLLOVER_HOUR', 3, 0, 23\);/,
  );
  assert.match(
    source,
    /new Date\(date\.getTime\(\) - DAILY_ROLLOVER_HOUR \* 60 \* 60 \* 1000\)/,
  );
  assert.doesNotMatch(source, /getDateKeyInZone\(DAILY_TIMEZONE\)/);
});
