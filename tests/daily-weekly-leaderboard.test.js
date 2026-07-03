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

test("historical Daily average leaderboard counts failures as 10", () => {
  const database = fs.readFileSync(path.join(root, "backend/database.js"), "utf8");
  const frontend = fs.readFileSync(path.join(root, "src/leaderboard.js"), "utf8");
  const server = fs.readFileSync(path.join(root, "backend/server.js"), "utf8");

  assert.match(database, /WHEN d\.success = TRUE THEN LEAST[\s\S]*ELSE 10/);
  assert.match(database, /COUNT\(\*\)::int AS participations/);
  assert.match(database, /HAVING COUNT\(\*\) > 10/);
  assert.match(database, /'philo14',\s*'test8',\s*'test9',\s*'testphil1'/);
  assert.match(database, /player_averages\.average_attempts ASC,\s*u\.username ASC/);
  assert.match(server, /\/api\/daily\/leaderboard\/averages/);
  assert.match(frontend, /Moyenne d’essais Daily — historique/);
  assert.match(frontend, /Daily terminés">Part\.<\/th>/);
});
