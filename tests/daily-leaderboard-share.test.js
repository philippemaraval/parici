const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(
  path.join(__dirname, "../src/daily-leaderboard-share.js"),
  "utf8",
);
const modulePromise = import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

test("sharing preserves every server rank and its distance/time tie-breaks without sorting or truncation", async () => {
  const { snapshotDailyLeaderboard } = await modulePromise;
  const rows = Array.from({ length: 20 }, (_, index) => ({
    username: `Joueur ${20 - index}`,
    attempts_count: index < 2 ? 1 : 2,
    solve_time_seconds: index === 0 ? 4 : 12,
    total_distance_meters: index * 100,
  }));
  const snapshot = snapshotDailyLeaderboard(rows);
  assert.equal(snapshot.length, 20);
  assert.deepEqual(
    snapshot.map((r) => r.username),
    rows.map((r) => r.username),
  );
  rows.reverse();
  rows[0].username = "Modifié après affichage";
  assert.equal(snapshot[0].username, "Joueur 20");
  assert.equal(snapshot[19].username, "Joueur 1");
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot[0]));
});

test("page and image share first-attempt speed and failure distance formatting", async () => {
  const { formatDailyLeaderboardResult: format } = await modulePromise;
  assert.equal(
    format({ success: true, attempts_count: 1, solve_time_seconds: 4.25 }),
    "1/7 · 4,3 s",
  );
  for (const solve_time_seconds of [null, undefined, -1, "invalide"]) {
    assert.equal(
      format({ success: true, attempts_count: 1, solve_time_seconds }),
      "1/7",
    );
  }
  assert.equal(
    format({ success: true, attempts_count: 2, solve_time_seconds: 10 }),
    "2/7",
  );
  assert.equal(
    format({ success: false, best_distance_meters: 234.6 }),
    "❌ 235m",
  );
});
