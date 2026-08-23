const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

test('Daily completion requests reminder permission from the completing click', () => {
  const frontend = fs.readFileSync(path.join(ROOT, 'src/app.js'), 'utf8');

  assert.match(
    frontend,
    /if \(n \|\| d <= 0\) \{\s*requestDailyReminderAfterCompletedDaily\(\);/,
  );
  assert.match(
    frontend,
    /Notification\.permission === "default"\s*\?\s*Notification\.requestPermission\(\)/,
  );
  assert.match(frontend, /wasDailyReminderAutoPromptedLocally\(\)/);
  assert.match(frontend, /\/api\/notifications\/prompted/);
});

test('Daily API excludes users already prompted or already subscribed', () => {
  const server = fs.readFileSync(path.join(ROOT, 'backend/server.js'), 'utf8');

  assert.match(server, /getDailyReminderPromptStatusForUser\(req\.user\.id\)/);
  assert.match(
    server,
    /reminderAutoPromptEligible:\s*pushRuntime\.enabled\s*&& !reminderPromptStatus\.prompted\s*&& !reminderPromptStatus\.hasActiveSubscription/,
  );
  assert.match(server, /app\.post\('\/api\/notifications\/prompted'/);
});
