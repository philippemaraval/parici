const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");

const databaseUrl = process.env.TEST_DATABASE_URL;

test(
  "API complète sur une base PostgreSQL éphémère",
  { skip: !databaseUrl, timeout: 90_000 },
  async (context) => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.NODE_ENV = "test";
    process.env.SECRET_KEY =
      "integration-test-secret-with-at-least-thirty-two-characters";
    process.env.ENABLE_ADMIN_ROUTES = "false";

    const database = require("../../backend/database");
    const { app, initializeDatabase } = require("../../backend/server");

    await initializeDatabase({ startBackgroundServices: false });
    // A second startup verifies that all migrations are idempotent and that the
    // version marker takes the fast path.
    await initializeDatabase({ startBackgroundServices: false });

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    context.after(async () => {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await database.pool.end();
    });

    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const request = async (path, options = {}) => {
      const response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers: {
          "content-type": "application/json",
          ...(options.headers || {}),
        },
      });
      return {
        response,
        body: await response.json(),
      };
    };

    const health = await request("/api/ready");
    assert.equal(health.response.status, 200);
    assert.equal(health.body.ok, true);
    assert.equal(health.body.database, "ready");
    assert.equal(Number.isFinite(health.body.durationMs), true);

    const hostileRegistration = await request("/api/register", {
      method: "POST",
      body: JSON.stringify({
        username: "<img src=x onerror=alert(1)>",
        password: "mot-de-passe-solide",
        recoveryEmail: "hostile@example.test",
      }),
    });
    assert.equal(hostileRegistration.response.status, 400);

    const username = `integration_${Date.now()}`;
    const password = "mot-de-passe-solide";
    const registration = await request("/api/register", {
      method: "POST",
      body: JSON.stringify({
        username,
        password,
        recoveryEmail: `${username}@example.test`,
      }),
    });
    assert.equal(registration.response.status, 200);
    assert.equal(registration.body.username, username);
    assert.ok(registration.body.token);

    const login = await request("/api/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    assert.equal(login.response.status, 200);
    assert.ok(login.body.token);

    const authHeaders = { authorization: `Bearer ${login.body.token}` };
    const dailyHealth = await request("/api/daily/health");
    assert.equal(dailyHealth.response.status, 200);
    assert.equal(dailyHealth.body.ok, true);
    assert.equal(dailyHealth.body.targetReady, true);
    assert.equal(dailyHealth.body.imageReady, true);

    const daily = await request("/api/daily", { headers: authHeaders });
    assert.equal(daily.response.status, 200);
    assert.match(daily.body.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(Array.isArray(JSON.parse(daily.body.targetGeoJson)), true);
    assert.equal(daily.body.userStatus.attempts_count, 0);
    assert.equal(daily.body.dailyStreak.current, 0);

    const dailyStreak = await request("/api/daily/streak", {
      headers: authHeaders,
    });
    assert.equal(dailyStreak.response.status, 200);
    assert.equal(dailyStreak.body.date, daily.body.date);
    assert.equal(dailyStreak.body.dailyStreak.current, 0);

    const score = await request("/api/scores", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        mode: "main",
        gameType: "classique",
        score: 90,
        itemsCorrect: 9,
        itemsTotal: 10,
        timeSec: 42,
        sessionId: `integration-${Date.now()}`,
      }),
    });
    assert.equal(score.response.status, 200);
    assert.equal(score.body.success, true);

    const hostileAvatar = await request("/api/profile/avatar", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ avatar: "<script>alert(1)</script>" }),
    });
    assert.equal(hostileAvatar.response.status, 400);

    const forbiddenAnalytics = await request("/api/analytics", {
      headers: authHeaders,
    });
    assert.equal(forbiddenAnalytics.response.status, 403);
  },
);
