const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

test(
  "admin revisions, permissions, archival and durable images on PostgreSQL",
  { skip: !process.env.TEST_DATABASE_URL, timeout: 180000 },
  async (context) => {
    const isolated = await require("./test-database").createTestDatabase(
      process.env.TEST_DATABASE_URL,
      "parici_admin",
    );
    process.env.DATABASE_URL = isolated.url;
    process.env.NODE_ENV = "production";
    process.env.CORS_ALLOWED_ORIGINS = "http://127.0.0.1:4179";
    process.env.SECRET_KEY =
      "admin-integration-secret-with-at-least-32-characters";
    const db = require("../../backend/database");
    const { app, initializeDatabase } = require("../../backend/server");
    let server, browser;
    context.after(async () => {
      if (browser) await browser.close();
      if (server) server.closeAllConnections();
      if (server) await new Promise((resolve) => server.close(resolve));
      await db.pool.end();
      await isolated.cleanup();
    });
    await initializeDatabase({ startBackgroundServices: false });
    await initializeDatabase({ startBackgroundServices: false });
    // Serve source pages with a local API origin so browser checks exercise the real API.
    const frontend = require("express")();
    let origin;
    frontend.get("/src/public/js/runtime-config.js", (_req, res) =>
      res
        .type("js")
        .send(`window.CaminoRuntimeConfig={apiUrl:${JSON.stringify(origin)}};`),
    );
    frontend.use(app);
    server = http.createServer(frontend);
    await new Promise((resolve) => server.listen(4179, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
    const request = async (route, token = "", method = "GET", body) => {
      const response = await fetch(origin + route, {
        signal: AbortSignal.timeout(20000),
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, data: await response.json() };
    };
    const password = "test-admin-password-2026";
    const accounts = {};
    for (const role of ["player", "editor", "admin"]) {
      const username = `audit_${role}`;
      const registration = await request("/api/register", "", "POST", {
        username,
        password,
        recoveryEmail: `${username}@example.test`,
      });
      assert.equal(registration.status, 200);
      if (role !== "player") await db.setUserRole(username, role);
      accounts[role] = (
        await request("/api/login", "", "POST", { username, password })
      ).data;
    }
    const admin = accounts.admin.token,
      editor = accounts.editor.token;
    const root = "/api/editor/operations-tools";
    assert.equal((await request(root + "/operations")).status, 401);
    assert.equal(
      (await request(root + "/operations", accounts.player.token)).status,
      403,
    );
    assert.equal((await request(root + "/operations", editor)).status, 200);
    assert.equal((await request(root + "/audit-log", editor)).status, 403);
    assert.equal(
      (await request("/api/editor/osm-sync", editor, "POST", {})).status,
      403,
    );
    const snapshot = (await request("/api/editor/content", editor)).data;
    const saveBody = {
      mode: "famous",
      streetName: "rue admin test",
      infoText: "Première version",
      expectedRevision: snapshot.revision,
    };
    const concurrent = await Promise.all([
      request("/api/editor/street-info", editor, "PUT", saveBody),
      request("/api/editor/street-info", editor, "PUT", {
        ...saveBody,
        infoText: "Deuxième version",
      }),
    ]);
    assert.deepEqual(
      concurrent.map((result) => result.status).sort(),
      [200, 409],
    );
    assert.equal(
      (await request("/api/editor/monuments", editor, "PUT", { entries: [] }))
        .status,
      428,
    );
    const revisions = (await request(root + "/revisions", editor)).data
      .revisions;
    assert.equal(revisions.length, 1);
    const detail = (
      await request(`${root}/revisions/${revisions[0].id}`, editor)
    ).data;
    assert.equal(detail.actor_username, "audit_editor");
    const current = (await request("/api/editor/content", admin)).data;
    const restorePath = `${root}/revisions/${revisions[0].id}/restore`;
    assert.equal(
      (
        await request(restorePath, admin, "POST", {
          expectedRevision: current.revision,
        })
      ).status,
      403,
    );
    const proof = (
      await request("/api/editor/confirm-action", admin, "POST", {
        path: restorePath,
        method: "POST",
        password,
      })
    ).data.confirmationToken;
    assert.ok(proof);
    assert.equal(
      (
        await request(restorePath, admin, "POST", {
          expectedRevision: current.revision,
          confirmationToken: proof,
        })
      ).status,
      200,
    );
    const restored = (await request("/api/editor/content", admin)).data;
    assert.equal(restored.streetInfos.famous["rue admin test"], undefined);
    assert.equal(
      (await request(root + "/revisions", admin)).data.revisions.length,
      2,
    );
    // Invalid input rolls back the entire edit and does not increment the revision.
    assert.equal(
      (
        await request("/api/editor/street-info", editor, "PUT", {
          expectedRevision: restored.revision,
          mode: "invalid",
        })
      ).status,
      400,
    );
    assert.equal(
      (await request("/api/editor/content", editor)).data.revision,
      restored.revision,
    );
    const created = await request(
      "/api/explorer/admin/riddles",
      editor,
      "POST",
      {
        way_id: 987654321,
        street_name_clean: "Rue admin test",
        riddle_text: "Question test",
        hint_text: "Indice test",
        image_url: "https://example.test/image.png",
        latitude: null,
        longitude: null,
      },
    );
    assert.equal(created.status, 201);
    const riddle = created.data.riddle;
    await db.pool.query(
      "INSERT INTO explorer_user_progress(user_id,riddle_id,started_at,solved_at,points_earned) VALUES($1,$2,NOW(),NOW(),10)",
      [accounts.player.id, riddle.id],
    );
    assert.equal(
      (
        await request(
          `/api/explorer/admin/riddles/${riddle.id}`,
          editor,
          "DELETE",
          { expectedRevision: riddle.revision },
        )
      ).status,
      200,
    );
    assert.equal(
      (await request("/api/explorer/riddles")).data.riddles.some(
        (row) => row.id === riddle.id,
      ),
      false,
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT COUNT(*)::int AS count FROM explorer_user_progress WHERE riddle_id=$1",
          [riddle.id],
        )
      ).rows[0].count,
      1,
    );
    assert.equal(
      (
        await request(
          `/api/explorer/admin/riddles/${riddle.id}/restore`,
          editor,
          "POST",
          { expectedRevision: riddle.revision + 1 },
        )
      ).status,
      200,
    );
    const imageData =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=";
    const upload = await request("/api/explorer/admin/images", editor, "POST", {
      data_url: imageData,
      file_name: "test.png",
    });
    assert.equal(upload.status, 201);
    const image = await fetch(origin + upload.data.image_url);
    assert.equal(image.status, 200);
    assert.match(image.headers.get("content-type"), /image\/png/);
    assert.deepEqual(
      Buffer.from(await image.arrayBuffer()),
      Buffer.from(imageData.split(",")[1], "base64"),
    );
    // Stored image survives database startup/migration, without a filesystem asset.
    await initializeDatabase({ startBackgroundServices: false });
    assert.equal((await fetch(origin + upload.data.image_url)).status, 200);
    assert.equal((await request("/api/editor/users", admin)).data.total, 3);
    assert.equal(
      (await request("/api/editor/users?search=audit_editor", admin)).data.users
        .length,
      1,
    );
    assert.equal(
      (await request(`${root}/daily-calendar?month=2026-10`, admin)).status,
      200,
    );
    assert.equal((await request(`${root}/audit-log`, admin)).status, 200);
    await assert.rejects(
      () => db.setUserRole("audit_admin", "player"),
      /dernier administrateur/,
    );
    await assert.rejects(
      () => db.deleteUserById(accounts.admin.id),
      /dernier administrateur/,
    );
    const resetPath = `/api/editor/users/${accounts.player.id}/password-reset-link`;
    assert.equal((await request(resetPath, admin, "POST", {})).status, 403);
    const resetProof = (
      await request("/api/editor/confirm-action", admin, "POST", {
        path: resetPath,
        method: "POST",
        password,
      })
    ).data.confirmationToken;
    assert.equal(
      (
        await request(resetPath, admin, "POST", {
          confirmationToken: resetProof,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request(
          `/api/editor/users/${accounts.editor.id}/password-reset-link`,
          admin,
          "POST",
          { confirmationToken: resetProof },
        )
      ).status,
      403,
    );
    await db.pool.query(
      "INSERT INTO scores(user_id,username,mode,game_type,score,timestamp) VALUES($1,'audit_player','rues-celebres','classique',2,NOW())",
      [accounts.player.id],
    );
    await db.pool.query(
      "INSERT INTO scores(user_id,username,mode,game_type,score,timestamp) SELECT $1,'audit_player','rues-celebres','classique',2,NOW() FROM generate_series(1,3)",
      [accounts.player.id],
    );
    const listed = (
      await request("/api/editor/users?search=audit_player", admin)
    ).data.users[0];
    assert.equal(listed.gamesPlayed, 4);
    assert.ok(
      Date.parse(listed.lastActivityAt) >= Date.parse(listed.lastGameAt),
    );
    const contentService = require("../../backend/domains/admin/content");
    const beforeRollback = (await request("/api/editor/content", admin)).data;
    await assert.rejects(
      () =>
        contentService.edit(
          db.pool,
          beforeRollback.revision,
          "test",
          "Test rollback",
          async () => {
            await db.setAppSetting("content_lists_v1", '{"famousStreets":[]}');
            throw new Error("rollback test");
          },
        ),
      /rollback test/,
    );
    assert.deepEqual(
      (await request("/api/editor/content", admin)).data,
      beforeRollback,
    );
    await db.pool.query(
      "INSERT INTO users(username,password_hash) SELECT 'pagination_' || value,'test-only-hash' FROM generate_series(1,52) value",
    );
    assert.equal(
      (await request(`${root}/players/${accounts.player.id}`, admin)).status,
      200,
    );
    assert.equal(
      (await request(`${root}/players/${accounts.player.id}`, editor)).status,
      403,
    );
    const pageTwo = (
      await request("/api/editor/users?page=2&search=pagination_", admin)
    ).data;
    assert.equal(pageTwo.total, 52);
    assert.equal(pageTwo.users.length, 2);
    if (process.env.CAMINO_REAL_BROWSER === "1") {
      const { chromium } = require("@playwright/test");
      browser = await chromium.launch(
        process.env.CI ? {} : { channel: "chrome" },
      );
      const screenshots =
        process.env.ADMIN_SCREENSHOT_DIR ||
        path.join(require("node:os").tmpdir(), "camino-admin-screenshots");
      fs.mkdirSync(screenshots, { recursive: true });
      for (const width of [320, 390, 430, 768, 1440]) {
        const page = await browser.newPage({
          viewport: { width, height: 950 },
        });
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.addInitScript((token) => {
          sessionStorage.setItem("camino_paris_editor_token", token);
          localStorage.setItem(
            "camino_paris_editor_user",
            JSON.stringify({ username: "audit_admin", role: "admin" }),
          );
        }, admin);
        for (const route of ["operations.html", "users.html", "explorer/"]) {
          await page.goto(origin + "/admin/" + route);
          await page.waitForLoadState("networkidle");
          if (route === "operations.html") {
            const { expect } = require("@playwright/test");
            await expect(page.locator("#operations-status")).toHaveText(
              "Données à jour.",
            );
            for (const section of ["history", "daily", "system", "overview"]) {
              await page.selectOption("#operations-section", section);
              await expect(page.locator("#operations-status")).toHaveText(
                "Données à jour.",
              );
              if (section === "history") {
                await page.locator("[data-revision]").first().click();
                await expect(page.locator("#operations-dialog")).toBeVisible();
                await page
                  .getByRole("button", { name: "Restaurer l’état précédent" })
                  .count();
                await page
                  .getByRole("button", { name: "Fermer", exact: true })
                  .click();
              }
            }
          }
          if (route === "users.html") {
            const { expect } = require("@playwright/test");
            await page.locator("#open-visit-stats-btn").click();
            await expect(page.locator("#visit-stats-summary")).toContainText(
              "visites au total",
            );
            await page.locator("#visit-stats-hourly-tab").click();
            await expect(page.locator("#visit-stats-summary")).toContainText(
              "Moyenne calculée",
            );
            await page.locator("#visit-stats-daily-tab").click();
            await expect(page.locator("#visit-stats-summary")).toContainText(
              "visites au total",
            );
            await page.locator("#close-visit-stats-btn").click();
            await expect(page.locator("#visit-stats-modal")).toBeHidden();
          }
          if (route === "explorer/")
            await page.fill("#explorer-filter", "Rue admin test");
          console.log("Browser", route, width, errors);
          await page.screenshot({
            path: path.join(
              screenshots,
              `${route.replace(/[/.]/g, "-")}-${width}.png`,
            ),
            fullPage: true,
          });
          if (route === "explorer/")
            console.log(
              "Overflow elements",
              await page.evaluate(() =>
                [...document.querySelectorAll("*")]
                  .filter((el) => el.getBoundingClientRect().right > innerWidth)
                  .slice(0, 10)
                  .map((el) => [
                    el.tagName,
                    el.className,
                    el.getBoundingClientRect().width,
                  ]),
              ),
            );
          assert.deepEqual(errors, []);

          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth > innerWidth,
            ),
            false,
            `${route} overflows at ${width}`,
          );
          await page.screenshot({
            path: path.join(
              screenshots,
              `${route.replace(/[/.]/g, "-")}-${width}.png`,
            ),
            fullPage: true,
          });
        }
        assert.deepEqual(errors, []);
        await page.close();
      }
    }
  },
);
