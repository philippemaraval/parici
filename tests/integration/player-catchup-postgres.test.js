const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const { createTestDatabase } = require("./test-database");

test(
  "Parici: authoritative sessions, concurrent Daily receipts, notification isolation and browser",
  { skip: !process.env.TEST_DATABASE_URL, timeout: 180000 },
  async (t) => {
    const isolated = await createTestDatabase(
      process.env.TEST_DATABASE_URL,
      "parici_catchup",
    );
    process.env.DATABASE_URL = isolated.url;
    process.env.NODE_ENV = "production";
    process.env.CORS_ALLOWED_ORIGINS = "http://127.0.0.1:4173";
    process.env.SECRET_KEY =
      "parici-test-secret-with-at-least-thirty-two-characters";
    process.env.ENABLE_ADMIN_ROUTES = "false";
    const db = require("../../backend/database");
    const { app, initializeDatabase } = require("../../backend/server");
    const server = http.createServer(app);
    t.after(async () => {
      await new Promise((resolve) => server.close(resolve));
      await db.pool.end();
      await isolated.cleanup();
    });
    await initializeDatabase({ startBackgroundServices: false });
    await initializeDatabase({ startBackgroundServices: false });
    await new Promise((resolve) =>
      server.listen(
        process.env.PARICI_BROWSER === "1" ? 4173 : 0,
        "127.0.0.1",
        resolve,
      ),
    );
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = async (
      path,
      body,
      token,
      method = body ? "POST" : "GET",
    ) => {
      const response = await fetch(base + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, body: await response.json() };
    };
    const register = async (username) => {
      const r = await request("/api/register", {
        username,
        password: "integration-password",
        recoveryEmail: username + "@example.test",
      });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      return r.body;
    };
    const user = await register("parici_catchup"),
      other = await register("parici_other");
    assert.equal(
      (
        await request("/api/game-sessions", {
          mode: "ville",
          gameType: "classique",
          availableNames: ["inventee"],
        })
      ).status,
      401,
    );
    const names = [
      ...new Set(
        JSON.parse(
          require("node:fs").readFileSync(
            require("node:path").resolve(
              __dirname,
              "../../backend/data/paris_rues_light.geojson",
            ),
            "utf8",
          ),
        ).features.map((f) => f.properties.name),
      ),
    ];
    const started = await request(
      "/api/game-sessions",
      { mode: "ville", gameType: "classique", availableNames: names },
      user.token,
    );
    assert.equal(started.status, 201, JSON.stringify(started.body));
    const id = started.body.sessionId;
    const scorePayload = {
      mode: "ville",
      gameType: "classique",
      score: 190,
      itemsCorrect: 20,
      itemsTotal: 20,
      timeSec: 0,
      sessionId: id,
    };
    assert.equal(
      (await request("/api/scores", scorePayload, user.token)).status,
      409,
    );
    assert.equal(
      (
        await request(
          `/api/game-sessions/${id}/answers`,
          {
            index: 0,
            requestId: crypto.randomUUID(),
            answerName: started.body.targets[0],
          },
          other.token,
        )
      ).status,
      404,
    );
    await request(
      `/api/game-sessions/${id}/pause`,
      { paused: true },
      user.token,
    );
    assert.equal(
      (
        await request(
          `/api/game-sessions/${id}/answers`,
          {
            index: 0,
            requestId: crypto.randomUUID(),
            answerName: started.body.targets[0],
          },
          user.token,
        )
      ).status,
      409,
    );
    await request(
      `/api/game-sessions/${id}/pause`,
      { paused: false },
      user.token,
    );
    for (let index = 0; index < started.body.targets.length; index++) {
      const body = {
        index,
        requestId: crypto.randomUUID(),
        answerName: started.body.targets[index],
      };
      const a = await request(
        `/api/game-sessions/${id}/answers`,
        body,
        user.token,
      );
      assert.equal(a.status, 200, JSON.stringify(a.body));
      assert.equal(a.body.correct, true);
      if (index === 0)
        assert.deepEqual(
          (await request(`/api/game-sessions/${id}/answers`, body, user.token))
            .body,
          a.body,
        );
    }
    const score = await request("/api/scores", scorePayload, user.token);
    assert.equal(score.status, 200, JSON.stringify(score.body));
    assert.equal(score.body.result.score, 200);
    assert.equal(score.body.result.itemsCorrect, started.body.targets.length);
    assert.equal(
      (await request("/api/scores", scorePayload, user.token)).body.duplicate,
      true,
    );
    const daily = await request("/api/daily", undefined, user.token);
    assert.equal(daily.status, 200, JSON.stringify(daily.body));
    const target = await db.getDailyTarget(daily.body.date);
    const wrong = names.find((name) => name !== target.street_name);
    const guess = {
      date: daily.body.date,
      answerName: wrong,
      requestId: crypto.randomUUID(),
      distanceMeters: 0,
      isSuccess: true,
      attemptsCount: 7,
    };
    const badLegacy = await request(
      "/api/daily/guess",
      {
        date: daily.body.date,
        distanceMeters: 0,
        isSuccess: true,
        attemptsCount: 1,
      },
      user.token,
    );
    assert.equal(badLegacy.status, 400);
    // Extra client-supplied results are not part of the new contract.
    delete guess.distanceMeters;
    delete guess.isSuccess;
    delete guess.attemptsCount;
    const results = await Promise.all([
      request("/api/daily/guess", guess, user.token),
      request("/api/daily/guess", guess, user.token),
    ]);
    assert.equal(results[0].status, 200, JSON.stringify(results));
    assert.deepEqual(results[0].body, results[1].body);
    assert.equal(results[0].body.attempts_count, 1);
    assert.equal(results[0].body.success, false);
    const concurrent = await Promise.all(
      [1, 2].map(() =>
        request(
          "/api/daily/guess",
          { ...guess, requestId: crypto.randomUUID() },
          user.token,
        ),
      ),
    );
    assert.deepEqual(
      concurrent.map((r) => r.body.attempts_count).sort(),
      [2, 3],
    );
    const notifications = await request(
      "/api/site/notifications",
      undefined,
      user.token,
    );
    assert.equal(notifications.status, 200);
    assert.equal(notifications.body.unread, 1);
    const opening = {
      keys: notifications.body.keys,
      snapshotAt: notifications.body.snapshotAt,
    };
    assert.equal(
      (await request("/api/site/notifications/open", opening, user.token))
        .status,
      200,
    );
    assert.equal(
      (await request("/api/site/notifications", undefined, user.token)).body
        .unread,
      0,
    );
    assert.equal(
      (await request("/api/site/notifications", undefined, other.token)).body
        .unread,
      1,
    );
    const win = await request(
      "/api/daily/guess",
      {
        date: daily.body.date,
        answerName: target.street_name,
        requestId: crypto.randomUUID(),
      },
      user.token,
    );
    assert.equal(win.status, 200);
    assert.equal(win.body.success, true);
    assert.equal(win.body.attempts_count, 4);
    assert.equal(
      (
        await request(
          "/api/daily/guess",
          { ...guess, requestId: crypto.randomUUID() },
          user.token,
        )
      ).status,
      409,
    );
    const report = await request(
      "/api/site/reports",
      {
        domain: "daily",
        entity_key: daily.body.date,
        category: "bug",
        detail: "Signalement de test du parcours Daily.",
      },
      user.token,
    );
    assert.equal(report.status, 201, JSON.stringify(report.body));
    assert.equal(
      (await request("/api/admin/site-reports", undefined, user.token)).status,
      403,
    );
    if (process.env.PARICI_BROWSER === "1") {
      const { chromium } = require("@playwright/test");
      const browser = await chromium.launch({
        channel: "chrome",
        headless: true,
      });
      try {
        const page = await browser.newPage();
        await page.route("**/src/public/js/runtime-config.js", (route) =>
          route.fulfill({
            contentType: "application/javascript",
            body: `window.CaminoRuntimeConfig=Object.freeze({apiUrl:${JSON.stringify(base)}});`,
          }),
        );
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.addInitScript(
          ({ api, user }) => {
            window.CaminoRuntimeConfig = { apiUrl: api };
            localStorage.setItem("camino_paris_user", JSON.stringify(user));
            localStorage.setItem("camino_auth_token", user.token);
          },
          { api: base, user },
        );
        for (const width of process.env.PARICI_GAME_ONLY
          ? []
          : [320, 390, 430, 768, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(base + "/?view=home");
          await page.locator("#site-menu-toggle").waitFor();
          require("node:fs").mkdirSync("/tmp/parici-review", {
            recursive: true,
          });
          await page.screenshot({
            path: `/tmp/parici-review/home-${width}.png`,
          });
          await page.locator("#site-menu-toggle").click();
          await page.locator("#site-menu-drawer[open]").waitFor();
          assert.equal(
            await page
              .locator('a[href*="collect.html"],a[href*="explorer.html"]')
              .count(),
            0,
          );
          await page.screenshot({
            path: `/tmp/parici-review/menu-${width}.png`,
          });
          await page
            .getByRole("button", { name: "Réglages", exact: true })
            .click();
          await page.getByRole("heading", { name: "Confort de jeu" }).waitFor();
          await page.locator("[data-close-drawer]").click();
          await page.waitForTimeout(400);
          await page.locator("#site-notification-bell").click();
          await page
            .getByRole("heading", { name: "Notifications", exact: true })
            .waitFor();
          await page.locator("[data-close-notifications]").click();
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth + 1,
          );
          assert.equal(overflow, false, `overflow ${width}`);
          for (const path of [
            "/versions.html",
            "/regles.html",
            "/remarques.html",
          ]) {
            await page.goto(base + path);
            assert.equal(
              await page
                .locator('a[href*="collect.html"],a[href*="explorer.html"]')
                .count(),
              0,
            );
            assert.equal(
              await page.evaluate(
                () => document.documentElement.scrollWidth > innerWidth + 1,
              ),
              false,
              `${path} overflow ${width}`,
            );
          }
        }
        await page.setViewportSize({ width: 390, height: 900 });
        await page.goto(base + "/?view=camino");
        await page.locator("body.app-ready").waitFor();
        const startResponse = page.waitForResponse(
          (response) =>
            response.url().endsWith("/api/game-sessions") &&
            response.request().method() === "POST",
        );
        await page.locator("#restart-btn").click();
        const startedGame = await startResponse.catch(async (error) => {
          console.log(
            "Browser startup diagnostics",
            JSON.stringify({
              errors,
              text: await page.locator("body").innerText(),
            }),
          );
          throw error;
        });
        assert.equal(startedGame.status(), 201, await startedGame.text());
        await page.waitForFunction(
          () =>
            document.querySelector("#target-street")?.textContent.trim() !==
            "—",
        );
        await page.screenshot({ path: "/tmp/parici-review/game-390.png" });
        for (let answer = 0; answer < 20; answer++)
          await page.locator("#skip-btn").click();
        await page
          .locator("#summary .summary-save-status")
          .filter({ hasText: "points enregistrés" })
          .waitFor();
        assert.deepEqual(
          errors.filter(
            (e) => !e.includes("Cannot redefine property: CaminoRuntimeConfig"),
          ),
          [],
        );
      } finally {
        await browser.close();
      }
    }
  },
);
