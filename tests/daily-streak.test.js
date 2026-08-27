const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  buildDailyAvailabilityPayload,
  buildDailyStreakReminderPayload,
} = require("../backend/daily-streak");

const ROOT = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("Daily streak reminders use Parici branding and correct French grammar", () => {
  assert.deepEqual(buildDailyAvailabilityPayload(), {
    title: "Parici Daily",
    body: "Le Daily est dispo. Lance ta partie du jour !",
    url: "/?view=daily",
    tag: "parici-daily-reminder",
  });
  assert.deepEqual(buildDailyStreakReminderPayload(0), {
    title: "🔥 Lance ta série Parici",
    body: "Le Daily du jour t’attend. Termine-le avant demain pour démarrer ta série !",
    url: "/?view=daily",
    tag: "parici-daily-streak-reminder",
  });
  assert.match(buildDailyStreakReminderPayload(1).body, /série de 1 Daily d’affilée/);
  assert.match(buildDailyStreakReminderPayload(12).body, /série de 12 Dailies d’affilée/);
});

test("Daily streaks count completed games and keep reminder states independent", () => {
  const database = read("backend/database.js");

  assert.match(database, /success = TRUE OR COALESCE\(attempts_count, 0\) >= 7/);
  assert.match(database, /end_day = \$2::date OR end_day = \(\$2::date - 1\)/);
  assert.match(database, /AS streak_count/);
  assert.match(database, /last_notified_on/);
  assert.match(database, /last_streak_notified_on/);
  assert.match(database, /COALESCE\(cs\.streak_len, 0\) > 0/);
  assert.match(database, /dua\.date = \$1::text\s+AND COALESCE\(dua\.attempts_count, 0\) > 0/);
  assert.match(database, /dua\.success = TRUE OR COALESCE\(dua\.attempts_count, 0\) >= 7/);
});

test("Daily page loads the streak and schedules both reminders", () => {
  const server = read("backend/server.js");
  const app = read("src/app.js");
  const page = read("index.html");
  const workflow = read(".github/workflows/daily-reminder-wakeup.yml");

  assert.match(server, /PUSH_REMINDER_HOUR', 10/);
  assert.match(server, /PUSH_STREAK_REMINDER_HOUR', 16/);
  assert.match(server, /getDailyStreakForUser\(req\.user\.id, date\)/);
  assert.match(server, /app\.get\('\/api\/daily\/streak'/);
  assert.match(server, /app\.get\('\/api\/daily\/health'/);
  assert.match(server, /getDailyStreakReminderPayload\(row\.streak_count\)/);
  assert.match(app, /function updateDailyStreakDisplay/);
  assert.match(app, /function setDailyStreakPendingDisplay/);
  assert.match(app, /setDailyStreakPendingDisplay\(\{ unavailable: true \}\)/);
  assert.match(app, /function refreshDailyStreakDisplay/);
  assert.match(app, /fetchWithStartupRetry\(\s*`\$\{API_URL\}\/api\/daily\/streak`/);
  assert.match(page, /data-daily-streak/);
  assert.match(page, /data-daily-streak-unit>j<\/span>/);
  assert.match(page, /data-daily-streak-count>…<\/strong>/);
  assert.doesNotMatch(page, /daily-streak-inline/);
  assert.match(workflow, /cron: "0 8,9,14,15 \* \* \*"/);
});
