const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
test("turning Daily off keeps the browser subscription while Collect still uses it", async () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");
  const start = source.indexOf("async function disableDailyReminder()");
  const end = source.indexOf("\nfunction ", start + 1);
  for (const keepSubscription of [true, false]) {
    let unsubscribed = 0,
      intent = true;
    const context = vm.createContext({
      currentUser: { token: "local-test" },
      API_URL: "https://example.test",
      console,
      setDailyReminderButtons() {},
      ensureServiceWorkerRegistration: async () => ({
        pushManager: {
          getSubscription: async () => ({
            endpoint: "https://example.test/push",
            unsubscribe: async () => {
              unsubscribed++;
            },
          }),
        },
      }),
      fetchWithTimeout: async () => ({
        ok: true,
        json: async () => ({ keepSubscription }),
      }),
      setDailyReminderIntent: (value) => {
        intent = value;
      },
      showMessage() {},
      refreshDailyReminderControls: async () => {},
    });
    vm.runInContext(source.slice(start, end), context);
    await context.disableDailyReminder();
    assert.equal(unsubscribed, keepSubscription ? 0 : 1);
    assert.equal(intent, false);
  }
});
