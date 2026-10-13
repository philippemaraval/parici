const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { createTestDatabase } = require("./test-database");

test(
  "Paris Explorer: real catalog, verified progress, archival, editor and browser",
  { skip: !process.env.TEST_DATABASE_URL, timeout: 300000 },
  async (t) => {
    const isolated = await createTestDatabase(
      process.env.TEST_DATABASE_URL,
      "parici_explorer",
    );
    process.env.DATABASE_URL = isolated.url;
    process.env.NODE_ENV = "production";
    process.env.CORS_ALLOWED_ORIGINS = "http://127.0.0.1:4173";
    process.env.SECRET_KEY =
      "local-explorer-test-secret-at-least-32-characters";
    const db = require("../../backend/database");
    const { app, initializeDatabase } = require("../../backend/server");
    const server = http.createServer(app);
    let browser;
    t.after(async () => {
      await browser?.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await db.pool.end();
      await isolated.cleanup();
    });
    await initializeDatabase({ startBackgroundServices: false });
    await initializeDatabase({ startBackgroundServices: false });
    await new Promise((resolve) =>
      server.listen(
        process.env.PARICI_EXPLORER_BROWSER === "1" ? 4173 : 0,
        "127.0.0.1",
        resolve,
      ),
    );
    const base = "http://127.0.0.1:" + server.address().port;
    async function request(route, body, token, method = body ? "POST" : "GET") {
      const response = await fetch(base + route, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: "Bearer " + token } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, body: await response.json() };
    }
    async function register(username) {
      const r = await request("/api/register", {
        username,
        password: "explorer-test-password",
        recoveryEmail: username + "@example.test",
      });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      return r.body;
    }
    const user = await register("explorer_player"),
      other = await register("explorer_other"),
      editor = await register("explorer_editor");
    await db.pool.query("UPDATE users SET role='admin' WHERE id=$1", [
      editor.id,
    ]);
    let catalog = await request("/api/explorer/riddles");
    assert.equal(catalog.status, 200);
    assert.equal(catalog.body.riddles.length, 12);
    const riddles = catalog.body.riddles;
    for (const r of riddles) {
      assert.ok(r.latitude > 48.8 && r.latitude < 48.9);
      assert.ok(r.longitude > 2.3 && r.longitude < 2.4);
      assert.ok(r.source_url.startsWith("https://"));
      const photo = await fetch(base + r.image_url);
      assert.equal(photo.status, 200);
      assert.match(photo.headers.get("content-type"), /image\/jpeg/);
    }
    const first = riddles[0];
    assert.equal((await request("/api/explorer/admin/riddles")).status, 401);
    assert.equal(
      (await request("/api/explorer/admin/riddles", null, user.token)).status,
      403,
    );
    assert.equal(
      (await request("/api/explorer/admin/riddles", null, editor.token)).body
        .riddles.length,
      12,
    );
    const streets = await request(
      "/api/explorer/admin/streets?q=Francs",
      null,
      editor.token,
    );
    assert.ok(
      streets.body.streets.some(
        (row) =>
          row.way_id > 0 && row.street_name_clean === first.street_name_clean,
      ),
    );
    const input = {
      riddle_id: first.id,
      ocr_text: first.street_name_clean,
      latitude: first.latitude,
      longitude: first.longitude,
      points_earned: 99999,
      walking_time_seconds: 0,
    };
    assert.equal(
      (await request("/api/explorer/progress/sync", input, user.token)).status,
      400,
    );
    assert.equal(
      (
        await request(
          "/api/explorer/leaderboard",
          { total_score: 99999 },
          user.token,
        )
      ).status,
      409,
    );
    assert.equal(
      (await request(`/api/explorer/riddles/${first.id}/start`, {}, user.token))
        .status,
      200,
    );
    assert.equal(
      (
        await request(
          "/api/explorer/progress/sync",
          { ...input, latitude: 43.3, longitude: 5.4 },
          user.token,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await request(
          "/api/explorer/progress/sync",
          { ...input, ocr_text: "rue inconnue" },
          user.token,
        )
      ).status,
      400,
    );
    assert.equal(
      (await request(`/api/explorer/riddles/${first.id}/hint`, {}, user.token))
        .status,
      200,
    );
    const completed = await Promise.all([
      request("/api/explorer/progress/sync", input, user.token),
      request("/api/explorer/progress/sync", input, user.token),
    ]);
    completed.forEach((result) => {
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(
        result.body.saved[0].points_earned,
        55 - Math.ceil(result.body.saved[0].walking_time_seconds / 60),
      );
      assert.equal(result.body.saved[0].hints_used, 1);
    });
    assert.equal(
      Number(
        (
          await db.pool.query(
            "SELECT COUNT(*) FROM explorer_user_progress WHERE user_id=$1",
            [user.id],
          )
        ).rows[0].count,
      ),
      1,
    );
    assert.equal(
      (await request("/api/explorer/progress", null, other.token)).body.progress
        .length,
      0,
    );
    assert.equal(
      (await request("/api/explorer/progress", null, user.token)).body.progress
        .length,
      1,
    );
    // An already-started step keeps its original content through an edit and archival.
    const second = riddles[1];
    await request(`/api/explorer/riddles/${second.id}/start`, {}, user.token);
    const changed = {
      ...second,
      street_name_clean: "Rue modifiée dans le test",
      expectedRevision: second.revision,
    };
    assert.equal(
      (
        await request(
          `/api/explorer/admin/riddles/${second.id}`,
          changed,
          editor.token,
          "PUT",
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await request(
          `/api/explorer/admin/riddles/${second.id}`,
          changed,
          editor.token,
          "PUT",
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await request(
          `/api/explorer/admin/riddles/${second.id}`,
          { expectedRevision: 2 },
          editor.token,
          "DELETE",
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await request(
          `/api/explorer/riddles/${second.id}/start`,
          {},
          other.token,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await request(
          `/api/explorer/riddles/${second.id}/start`,
          {},
          user.token,
        )
      ).status,
      200,
    );
    const archivedResult = await request(
      "/api/explorer/progress/sync",
      {
        riddle_id: second.id,
        ocr_text: second.street_name_clean,
        latitude: second.latitude,
        longitude: second.longitude,
      },
      user.token,
    );
    assert.equal(
      archivedResult.status,
      200,
      JSON.stringify(archivedResult.body),
    );
    assert.equal(
      (await request("/api/explorer/riddles")).body.riddles.length,
      11,
    );
    assert.equal(
      (
        await request(
          `/api/explorer/admin/riddles/${second.id}/restore`,
          { expectedRevision: 3 },
          editor.token,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await request(
          `/api/explorer/admin/riddles/${second.id}`,
          { ...second, expectedRevision: 4 },
          editor.token,
          "PUT",
        )
      ).status,
      200,
    );
    // Restarting migrations neither recreates an archived seed nor overwrites an edit.
    await initializeDatabase({ startBackgroundServices: false });
    assert.equal(
      (await request("/api/explorer/riddles")).body.riddles.length,
      12,
    );
    const simulation = await request(
      "/api/explorer/admin/simulate",
      { riddle: first, answer: input },
      editor.token,
    );
    assert.equal(simulation.status, 200);
    assert.equal(simulation.body.valid, true);
    assert.equal(
      (
        await request(
          "/api/explorer/admin/simulate",
          { riddle: first, answer: input },
          user.token,
        )
      ).status,
      403,
    );
    for (const r of riddles.slice(2)) {
      await request(`/api/explorer/riddles/${r.id}/start`, {}, user.token);
      const result = await request(
        "/api/explorer/progress/sync",
        {
          riddle_id: r.id,
          ocr_text: r.street_name_clean,
          latitude: r.latitude,
          longitude: r.longitude,
        },
        user.token,
      );
      assert.equal(result.status, 200, JSON.stringify(result.body));
    }
    const finish = await request(
      "/api/explorer/leaderboard",
      { total_score: 99999, total_walking_time_seconds: 0 },
      user.token,
    );
    assert.equal(finish.status, 200, JSON.stringify(finish.body));
    const earned = (
      await request("/api/explorer/progress", null, user.token)
    ).body.progress.reduce((sum, row) => sum + row.points_earned, 0);
    assert.equal(finish.body.leaderboard.total_score, earned);
    assert.equal(
      (await request("/api/explorer/leaderboard")).body.leaderboard[0]
        .total_score,
      earned,
    );
    const image = fs.readFileSync(
      path.resolve(__dirname, "../../data/explorer_images/marais-01.jpg"),
    );
    const uploaded = await request(
      "/api/explorer/admin/images",
      { data_url: "data:image/jpeg;base64," + image.toString("base64") },
      editor.token,
    );
    assert.equal(uploaded.status, 201);
    const served = await fetch(base + uploaded.body.image_url);
    assert.equal(served.status, 200);
    assert.deepEqual(Buffer.from(await served.arrayBuffer()), image);
    if (process.env.PARICI_EXPLORER_BROWSER === "1") {
      const { chromium } = require("@playwright/test");
      browser = await chromium.launch({
        channel: "chrome",
        headless: true,
      });

      const context = await browser.newContext({
        serviceWorkers: "block",
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        permissions: ["geolocation"],
        geolocation: { latitude: first.latitude, longitude: first.longitude },
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/src/public/js/runtime-config.js", (route) =>
        route.fulfill({
          contentType: "application/javascript",
          body: `window.CaminoRuntimeConfig=Object.freeze({apiUrl:${JSON.stringify(base)}});`,
        }),
      );
      await page.addInitScript(
        ({ user }) => {
          Object.defineProperty(navigator, "userAgentData", {
            value: { mobile: true },
            configurable: true,
          });
          localStorage.setItem("camino_paris_user", JSON.stringify(user));
          localStorage.setItem("camino_auth_token", user.token);
          localStorage.setItem("parici_explorer_completed:"+user.id,"1");
        },
        { user: other },
      );
      fs.mkdirSync("/tmp/parici-explorer-review", { recursive: true });
      for (const route of [
        "/?view=home",
        "/regles.html",
        "/versions.html",
        "/remarques.html",
      ]) {
        await page.goto(base + route);
        if (await page.locator("#site-menu-toggle").count()) {
          await page
            .locator("#site-menu-drawer")
            .waitFor({ state: "attached" });
          await page.locator("#site-menu-toggle").click();
          await page.locator("#site-menu-drawer[open]").waitFor();
          assert.equal(
            await page
              .locator('a[href*="explorer.html"],a[href*="collect.html"]')
              .count(),
            0,
          );
          assert.equal(
            await page
              .locator(
                'footer a[href="/confidentialite.html"],footer a[href^="mailto:"],.site-footer a[href="/confidentialite.html"],.site-footer a[href^="mailto:"]',
              )
              .count(),
            0,
          );
          await page.locator("[data-close-drawer]").click();
        }
      }
      await page.goto(base + "/explorer.html");
      await page.locator("#explorer-start-btn").waitFor({ state: "visible" });
      assert.equal(await page.locator("#explorer-total").innerText(), "12");
      assert.equal(
        await page
          .locator('a[href*="explorer.html"],a[href*="collect.html"]')
          .count(),
        0,
      );
      await page.locator("#explorer-start-btn").click();
      await page.locator("#explorer-riddle:not(.hidden)").waitFor();
      await page.waitForFunction(
        (key) => localStorage.getItem(key) !== null,
        "parici_explorer_state_v1:" + other.id,
      );
      const local = await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)),
        "parici_explorer_state_v1:" + other.id,
      );
      const selected = riddles.find((r) => r.id === local.currentRiddleId);
      assert.equal(selected.id, first.id);
      await page
        .locator("#explorer-riddle-image")
        .evaluate((image) => image.decode());
      await page.screenshot({
        path: "/tmp/parici-explorer-review/play-mobile.png",
        fullPage: true,
      });
      // Run the actual OCR engine on a deterministic test plaque; no application API is mocked.
      const plaque = await page.evaluate(async (name) => {
        const canvas = document.createElement("canvas");
        canvas.width = 1800;
        canvas.height = 420;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#12297a";
        ctx.fillRect(0, 0, 1800, 420);
        ctx.fillStyle = "white";
        ctx.font = "bold 74px Arial";
        ctx.textAlign = "center";
        ctx.fillText(name.toUpperCase(), 900, 230);
        return Array.from(
          new Uint8Array(
            await (
              await new Promise((resolve) =>
                canvas.toBlob(resolve, "image/png"),
              )
            ).arrayBuffer(),
          ),
        );
      }, first.street_name_clean);
      const sync = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/explorer/progress/sync") &&
          response.request().method() === "POST",
        { timeout: 120000 },
      );
      await page.locator("#explorer-photo-input").setInputFiles({
        name: "test-plaque.png",
        mimeType: "image/png",
        buffer: Buffer.from(plaque),
      });
      const confirmed = await sync;
      assert.equal(confirmed.status(), 200, await confirmed.text());
      await page.locator("#explorer-discovery:not(.hidden)").waitFor();
      await page
        .locator("#explorer-discovery-source")
        .waitFor({ state: "visible" });
      await page.reload();
      await page.locator("#explorer-solved").filter({ hasText: "1" }).waitFor();
      assert.equal(
        (await request("/api/explorer/progress", null, other.token)).body
          .progress.length,
        1,
      );
      // Editor authenticates through the existing Parici admin session.
      await page.addInitScript(
        ({ editor }) => {
          localStorage.setItem(
            "camino_paris_editor_user",
            JSON.stringify(editor),
          );
          sessionStorage.setItem("camino_paris_editor_token", editor.token);
        },
        { editor },
      );
      await page.goto(base + "/admin/explorer/");
      await page.locator("#explorer-admin-content:not(.hidden)").waitFor();
      await page.locator(`[data-edit="${first.id}"]`).click();
      await page
        .locator("#explorer-preview-image")
        .waitFor({ state: "visible" });
      await page
        .locator("#explorer-simulation-ocr")
        .fill(first.street_name_clean);
      await page.locator("#explorer-simulate").click();
      await page
        .locator("#explorer-simulation-result")
        .filter({ hasText: "Validation réussie" })
        .waitFor();
      await page.screenshot({
        path: "/tmp/parici-explorer-review/editor-mobile.png",
        fullPage: true,
      });
      for (const width of [320, 390, 430, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth + 1,
          ),
          false,
          "editor overflow " + width,
        );
      }
      assert.deepEqual(errors, []);
    }
  },
);
