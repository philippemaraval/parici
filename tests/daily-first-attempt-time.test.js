const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");

test("Daily leaderboard exposes and displays solve time only for 1/7 successes", () => {
  const database = fs.readFileSync(path.join(root, "backend/database.js"), "utf8");
  const frontend = fs.readFileSync(path.join(root, "src/leaderboard.js"), "utf8");

  assert.match(
    database,
    /AND LEAST\(COALESCE\(d\.attempts_count, 0\), 7\) = 1[\s\S]*END AS solve_time_seconds/,
  );
  assert.match(
    frontend,
    /row\.success && Number\(row\.attempts_count\) === 1[\s\S]*formatDailySolveTime\(row\.solve_time_seconds\)/,
  );
  assert.match(frontend, /solveTime \? ` · \$\{solveTime\}` : ""/);
});

test("current Daily leaderboard uses balanced column widths", () => {
  const frontend = fs.readFileSync(path.join(root, "src/leaderboard.js"), "utf8");
  const styles = fs.readFileSync(path.join(root, "style.css"), "utf8");

  assert.match(frontend, /leaderboard-table daily-current-leaderboard/);
  assert.match(styles, /\.daily-current-leaderboard th:first-child\s*\{\s*width: 14%/);
  assert.match(styles, /\.daily-current-leaderboard th:nth-child\(2\)\s*\{\s*width: 48%/);
  assert.match(styles, /\.daily-current-leaderboard th:nth-child\(3\)\s*\{\s*width: 38%/);
  assert.match(
    styles,
    /\.daily-current-leaderboard th:last-child,[\s\S]*\.daily-current-leaderboard td:last-child\s*\{\s*text-align: left/,
  );
});
