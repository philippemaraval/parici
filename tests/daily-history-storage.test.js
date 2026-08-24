const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');

test('Daily history stores every guess and exposes an admin date view', () => {
  const database = fs.readFileSync(path.join(ROOT, 'backend/database.js'), 'utf8');
  const server = fs.readFileSync(path.join(ROOT, 'backend/server.js'), 'utf8');

  assert.match(database, /CREATE TABLE IF NOT EXISTS daily_attempt_details/);
  assert.match(database, /UNIQUE\(user_id, date, attempt_number\)/);
  assert.match(database, /elapsed_seconds/);
  assert.match(database, /solve_time_seconds/);
  assert.match(database, /getDailyHistory/);
  assert.match(server, /\/api\/editor\/daily-history/);
  assert.match(server, /requireAdminUser/);
});
