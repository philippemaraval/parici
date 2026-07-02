const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");

test("weekly Daily leaderboard sums and displays player gaps", () => {
  const database = fs.readFileSync(path.join(root, "backend/database.js"), "utf8");
  const frontend = fs.readFileSync(path.join(root, "main.js"), "utf8");

  assert.match(database, /SUM\(completed\.best_distance_meters\)::int AS total_distance_meters/);
  assert.match(database, /total_distance_meters ASC NULLS LAST/);
  assert.match(frontend, /Total \\xE9cart/);
  assert.match(frontend, /row\.total_distance_meters/);
});
