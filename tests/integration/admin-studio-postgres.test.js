const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

test(
  "admin studio: real publishing, permissions, reports, support, MFA and browser workflows",
  { skip: !process.env.TEST_DATABASE_URL, timeout: 360000 },
  async (t) => {
    const isolated = await require("./test-database").createTestDatabase(
      process.env.TEST_DATABASE_URL,
      "parici_studio",
    );
    process.env.DATABASE_URL = isolated.url;
    process.env.NODE_ENV = "production";
    process.env.SECRET_KEY = "admin-studio-test-secret-over-32-characters";
    process.env.CORS_ALLOWED_ORIGINS = "http://127.0.0.1:4181";
    const db = require("../../backend/database");
    const { app, initializeDatabase } = require("../../backend/server");
    let server, browser;
    t.after(async () => {
      if (browser) await browser.close();
      if (server) {
        server.closeAllConnections();
        await new Promise((r) => server.close(r));
      }
      await db.pool.end();
      await isolated.cleanup();
    });
    await initializeDatabase({ startBackgroundServices: false });
    await initializeDatabase({ startBackgroundServices: false });
    const express = require("express"),
      front = express();
    const origin = "http://127.0.0.1:4181";
    front.get("/src/public/js/runtime-config.js", (_req, res) =>
      res
        .type("js")
        .send(`window.CaminoRuntimeConfig={apiUrl:${JSON.stringify(origin)}}`),
    );
    front.use(app);
    server = http.createServer(front);
    await new Promise((r) => server.listen(4181, "127.0.0.1", r));
    const request = async (
      route,
      token = "",
      method = "GET",
      body,
      headers = {},
    ) => {
      const r = await fetch(origin + route, {
        signal: AbortSignal.timeout(30000),
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: "Bearer " + token } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: r.status, data: await r.json() };
    };
    const root = "/api/editor/studio",
      password = "studio-test-password-2026",
      accounts = {};
    for (const role of ["player", "editor", "admin"]) {
      const username = "studio_" + role;
      assert.equal(
        (
          await request("/api/register", "", "POST", {
            username,
            password,
            recoveryEmail: username + "@example.test",
          })
        ).status,
        200,
      );
      if (role !== "player") await db.setUserRole(username, role);
      accounts[role] = (
        await request("/api/login", "", "POST", { username, password })
      ).data;
    }
    let admin = accounts.admin.token,
      editor = accounts.editor.token;
    const player = accounts.player;
    const confirm = async (path, token = admin, headers = {}) => {
      await db.pool.query(
        "DELETE FROM api_rate_limits WHERE bucket_key LIKE 'admin-confirm:%'",
      );
      const r = await request(
        "/api/editor/confirm-action",
        token,
        "POST",
        {
          path: root + path,
          method: path.startsWith("/permissions/") ? "PUT" : "POST",
          password,
        },
        headers,
      );
      assert.equal(r.status, 200, JSON.stringify(r.data));
      return r.data.confirmationToken;
    };
    const sensitive = async (
      path,
      body = {},
      token = admin,
      method = "POST",
      headers = {},
    ) =>
      request(
        root + path,
        token,
        method,
        { ...body, confirmationToken: await confirm(path, token, headers) },
        headers,
      );
    assert.equal((await request(root + "/tasks")).status, 401);
    assert.equal((await request(root + "/tasks", player.token)).status, 403);
    for (const route of [
      "/tasks",
      "/quality",
      "/analytics",
      "/balance",
      "/reports",
      "/drafts",
      "/history",
      "/explorer",
      "/events",
      "/campaigns",
      "/operations",
      "/backups",
      "/sessions",
      "/permissions",
    ]) {
      const r = await request(root + route, admin);
      assert.equal(r.status, 200, route + JSON.stringify(r.data));
    }
    assert.equal((await request(root + "/permissions", editor)).status, 403);
    // Drafts are separate from live records; publishing is optimistic and atomic.
    const card = (
      await db.pool.query(
        "SELECT * FROM cards WHERE status='active' AND catalog_present ORDER BY id LIMIT 1",
      )
    ).rows[0];
    const create = async (kind, key, payload, token = admin) => {
      const r = await request(root + "/drafts", token, "POST", {
        kind,
        entity_key: String(key),
        title: "Test " + kind,
        payload,
      });
      assert.equal(r.status, 201, JSON.stringify(r.data));
      return r.data;
    };
    const cardPayload = {
      description_override: "Description préparée",
      description_full_override: "Notice préparée",
      image_override: null,
      image_credit_override: null,
    };
    const draft = await create("card", card.id, cardPayload);
    assert.equal(
      (
        await db.pool.query(
          "SELECT description_override FROM cards WHERE id=$1",
          [card.id],
        )
      ).rows[0].description_override,
      card.description_override,
    );
    assert.equal(
      (
        await request(
          root + "/drafts/" + draft.id + "/publish",
          admin,
          "POST",
          { revision: 0 },
        )
      ).status,
      403,
    );
    assert.equal(
      (await sensitive("/drafts/" + draft.id + "/publish", { revision: 0 }))
        .status,
      200,
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT description_override FROM cards WHERE id=$1",
          [card.id],
        )
      ).rows[0].description_override,
      "Description préparée",
    );
    assert.equal(
      (await sensitive("/drafts/" + draft.id + "/publish", { revision: 0 }))
        .status,
      409,
    );
    const stale = await create("card", card.id, {
      ...cardPayload,
      description_override: "Autre",
    });
    await db.pool.query(
      "UPDATE cards SET image_credit_override=$2 WHERE id=$1",
      [card.id, "Édition concurrente"],
    );
    assert.equal(
      (await sensitive("/drafts/" + stale.id + "/publish", { revision: 0 }))
        .status,
      409,
    );
    const revision = (
      await db.pool.query(
        "SELECT id FROM admin_entity_revisions WHERE domain='card' AND entity_key=$1 ORDER BY id DESC LIMIT 1",
        [String(card.id)],
      )
    ).rows[0];
    assert.equal(
      (
        await request(
          root + "/history/" + revision.id + "/restore-draft",
          admin,
          "POST",
          {},
        )
      ).status,
      201,
    );
    const street = await create("street", "rue test studio", {
      mode: "famous",
      name: "rue test studio",
      description: "Fiche préparée",
    });
    assert.equal(
      (await sensitive("/drafts/" + street.id + "/publish", { revision: 0 }))
        .status,
      200,
    );
    assert.equal(
      JSON.parse(
        (
          await db.pool.query(
            "SELECT value_text FROM app_settings WHERE key='content_street_infos_v1'",
          )
        ).rows[0].value_text,
      ).famous["rue test studio"],
      "Fiche préparée",
    );
    // Future Daily can be prepared; current/past targets cannot be replaced.
    const future = "2099-01-01",
      daily = await create("daily", future, {
        date: future,
        street_name: "Rue de Sablonville",
        quartier: "Quartier des Ternes",
        coordinates: [2.3522, 48.8566],
        image_url: "https://example.test/image.png",
        verified: true,
      });
    assert.equal(
      (await sensitive("/drafts/" + daily.id + "/publish", { revision: 0 }))
        .status,
      200,
    );
    assert.equal(
      (await db.getDailyTarget(future)).image_url,
      "https://example.test/image.png",
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT image_override FROM cards WHERE source_entity_id='Rue de Sablonville'",
        )
      ).rows[0].image_override,
      "https://example.test/image.png",
    );
    assert.equal(
      await require("../../backend/domains/collect/daily-image").dailyImageForStreet(
        db.pool,
        "Rue de Sablonville",
        "/old.jpg",
      ),
      "https://example.test/image.png",
    );
    const activeDaily = await request("/api/daily/health", accounts.player.token);
    assert.equal(activeDaily.status, 200, JSON.stringify(activeDaily.data));
    const today = activeDaily.data.date;
    assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
    await db.setDailyTarget(
      today,
      "Rue test studio",
      "Quartier Saint-Gervais",
      [2.3522, 48.8566],
      null,
    );
    await db.pool.query("UPDATE daily_targets SET image_url=$2 WHERE date=$1", [
      today,
      "https://example.test/explicit-daily.png",
    ]);
    const liveDaily = await request("/api/daily", accounts.player.token);
    assert.equal(liveDaily.status, 200, JSON.stringify(liveDaily.data));
    assert.equal(
      liveDaily.data.dailyImageUrl,
      "https://example.test/explicit-daily.png",
    );
    const past = await create("daily", "2020-01-01", {
      ...daily.payload,
      date: "2020-01-01",
      verified: true,
    });
    assert.equal(
      (await sensitive("/drafts/" + past.id + "/publish", { revision: 0 }))
        .status,
      409,
    );
    const scheduled = await create("card", card.id, {
      ...cardPayload,
      description_override: "Publication programmée",
    });
    assert.equal(
      (
        await sensitive("/drafts/" + scheduled.id + "/schedule", {
          revision: 0,
          publishAt: "2099-01-01T00:00:00Z",
        })
      ).status,
      200,
    );
    await db.pool.query(
      "UPDATE admin_drafts SET publish_at=NOW()-INTERVAL '1 minute' WHERE id=$1",
      [scheduled.id],
    );
    await require("../../backend/domains/admin/editorial").tick(
      db.pool,
      () => {},
    );
    assert.equal(
      (
        await db.pool.query("SELECT state FROM admin_drafts WHERE id=$1", [
          scheduled.id,
        ])
      ).rows[0].state,
      "published",
    );
    const event = await create("event", "2099-01-05", {
      week_start: "2099-01-05",
      objectives: [
        { kind: "monument", target: 1, label: "Monuments" },
        { kind: "quartier", target: 1, label: "Quartiers" },
      ],
    });
    const eventPreview = await request(
      root + "/drafts/" + event.id + "/preview",
      admin,
      "POST",
      {},
    );
    assert.equal(eventPreview.status, 200);
    assert.ok(eventPreview.data.event.reward.weights);
    assert.equal(
      (await sensitive("/drafts/" + event.id + "/publish", { revision: 0 }))
        .status,
      200,
    );
    // Common report intake and tracked resolution.
    const report = await request("/api/site/reports", player.token, "POST", {
      domain: "daily",
      entity_key: future,
      category: "image",
      detail: "La photo présente un lieu différent.",
    });
    assert.equal(report.status, 201);
    const reports = await request(root + "/reports", admin);
    const r = reports.data.reports.find((r) => r.id === report.data.id);
    assert.ok(r);
    assert.equal(
      (
        await request(root + "/reports/" + r.id, admin, "PUT", {
          status: "resolved",
          severity: "high",
          resolution: "Photo comparée aux coordonnées.",
          assignee_id: accounts.admin.id,
          revision: r.revision,
        })
      ).status,
      200,
    );
    // Assistance is previewed, protected and idempotent; rewards are distinct from gameplay.
    const operation = {
      action: "grant-card",
      cardId: Number(card.id),
      reason: "Réparation ciblée validée en test.",
      requestId: require("node:crypto").randomUUID(),
    };
    const before = await request(
      root + "/players/" + player.id + "/preview",
      admin,
      "POST",
      operation,
    );
    assert.equal(before.status, 200);
    const apply = { ...operation, fingerprint: before.data.fingerprint };
    assert.equal(
      (await sensitive("/players/" + player.id + "/intervene", apply)).status,
      200,
    );
    assert.equal(
      (await sensitive("/players/" + player.id + "/intervene", apply)).status,
      200,
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT COUNT(*)::int AS n FROM card_copies WHERE user_id=$1 AND source='admin'",
          [player.id],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await sensitive("/players/" + player.id + "/intervene", {
          ...apply,
          action: "suspend",
        })
      ).status,
      409,
    );
    // Granular permissions affect both the studio and legacy writes.
    assert.equal(
      (
        await sensitive(
          "/permissions/" + accounts.editor.id,
          {
            permissions: { publish: false },
            reason: "Préparation sans publication.",
          },
          admin,
          "PUT",
        )
      ).status,
      200,
    );
    editor = (
      await request("/api/login", "", "POST", {
        username: "studio_editor",
        password,
      })
    ).data.token;
    const deniedDraft = await create("card", card.id, cardPayload, editor);
    assert.equal(
      (
        await sensitive(
          "/drafts/" + deniedDraft.id + "/publish",
          { revision: 0 },
          editor,
        )
      ).status,
      403,
    );
    assert.equal(
      (await request("/api/explorer/admin/riddles", editor, "POST", {})).status,
      403,
    );
    // Explorer simulator uses the shared player selection and geometry.
    const simulation = await request(
      root + "/explorer/simulate",
      admin,
      "POST",
      { position: { latitude: 48.8566, longitude: 2.3522 }, solved: [] },
    );
    assert.equal(simulation.status, 200);
    assert.equal(simulation.data.candidates.length, 1);
    const second = await request(root + "/explorer/simulate", admin, "POST", {
      position: { latitude: 48.8566, longitude: 2.3522 },
      solved: [simulation.data.choice.id],
    });
    assert.equal(
      second.data.candidates.length,
      Math.min(5, simulation.data.remaining - 1),
    );
    assert.ok(
      !second.data.candidates.some((r) => r.id === simulation.data.choice.id),
    );
    // Campaign test and real site inbox delivery, preference exclusions, no remote sends.
    const campaign = (
      await request(root + "/campaigns", admin, "POST", {
        title: "Test atelier",
        body: "Message de test local.",
        url: "/collect.html",
        audience: "all",
      })
    ).data;
    assert.equal(
      (
        await request(
          root + "/campaigns/" + campaign.id + "/test",
          admin,
          "POST",
          {},
        )
      ).status,
      200,
    );
    assert.ok(
      (await request("/api/site/notifications", admin)).data.items.some((i) =>
        i.key.startsWith("announcement:"),
      ),
    );
    await db.pool.query(
      "UPDATE users SET admin_announcements=FALSE WHERE id=$1",
      [player.id],
    );
    const audience = (
      await request(
        root + "/campaigns/" + campaign.id + "/preview",
        admin,
        "POST",
        {},
      )
    ).data;
    assert.equal(audience.count, 2);
    assert.equal(
      (
        await sensitive("/campaigns/" + campaign.id + "/send", {
          fingerprint: audience.fingerprint,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT COUNT(*)::int AS n FROM admin_campaign_deliveries WHERE user_id=$1 AND NOT test",
          [player.id],
        )
      ).rows[0].n,
      0,
    );
    // Real browser, all 15 views at each target width; route/API failures are collected.
    if (process.env.CAMINO_REAL_BROWSER === "1") {
      const { chromium, expect } = require("@playwright/test");
      browser = await chromium.launch(
        process.env.CI ? {} : { channel: "chrome" },
      );
      const dir =
        process.env.ADMIN_SCREENSHOT_DIR ||
        path.join(
          require("node:os").tmpdir(),
          "camino-admin-studio-screenshots",
        );
      fs.mkdirSync(dir, { recursive: true });
      for (const width of [320, 390, 430, 768, 1440]) {
        await db.pool.query(
          "DELETE FROM api_rate_limits WHERE bucket_key LIKE 'admin-studio:%'",
        );
        const page = await browser.newPage({
            viewport: { width, height: 950 },
          }),
          errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.route(
          "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
          (r) =>
            r.fulfill({
              path: path.resolve("node_modules/leaflet/dist/leaflet.js"),
              contentType: "text/javascript",
            }),
        );
        await page.route(
          "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
          (r) =>
            r.fulfill({
              path: path.resolve("node_modules/leaflet/dist/leaflet.css"),
              contentType: "text/css",
            }),
        );
        await page.addInitScript((token) => {
          sessionStorage.setItem("camino_paris_editor_token", token);
        }, admin);
        await page.goto(origin + "/admin/studio.html");
        for (const view of [
          "tasks",
          "daily",
          "drafts",
          "reports",
          "quality",
          "players",
          "analytics",
          "explorer",
          "balance",
          "events",
          "history",
          "security",
          "campaigns",
          "operations",
          "backups",
        ]) {
          await page.locator('#studio-nav a[data-view="' + view + '"]').click();
          await expect(page.locator("#studio-status")).toHaveText(
            "Données à jour.",
            { timeout: 15000 },
          );
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth > innerWidth,
            ),
            false,
            view + " overflow at " + width,
          );
          await page.screenshot({
            path: path.join(dir, view + "-" + width + ".png"),
            fullPage: true,
          });
        }
        await page.locator('[data-view="drafts"]').click();
        await expect(page.locator("#studio-status")).toHaveText(
          "Données à jour.",
        );
        await page
          .getByRole("button", { name: "Nouveau brouillon", exact: true })
          .click();
        await page.locator("select[name=kind]").selectOption("explorer");
        await page
          .getByRole("button", { name: "Préparer", exact: true })
          .click();
        await page
          .locator("input[name=title]")
          .fill("Énigme navigateur " + width);
        await page.locator("input[name=way_id]").fill(String(900000 + width));
        await page
          .locator("input[name=street_name_clean]")
          .fill("Rue navigateur " + width);
        await page.locator("textarea[name=riddle_text]").fill("Quelle rue ?");
        await page.locator("textarea[name=hint_text]").fill("Un indice");
        await page
          .locator("input[name=image_url]")
          .fill("https://example.test/image.png");
        await page
          .getByRole("button", {
            name: "Enregistrer le brouillon",
            exact: true,
          })
          .click();
        await expect(
          page.getByRole("button", { name: "Publier maintenant" }),
        ).toBeVisible();
        await page.screenshot({
          path: path.join(dir, "draft-preview-" + width + ".png"),
          fullPage: true,
        });
        await page.locator("#studio-close").click();
        assert.deepEqual(errors, []);
        await page.close();
      }
    }
    // TOTP enrollment, replay rejection, step-up across old/new APIs and recovery.
    const security = require("../../backend/domains/admin/security");
    const enrollment = await sensitive("/mfa/enroll");
    assert.equal(enrollment.status, 200);
    const code = security.totp(
      enrollment.data.secret,
      Math.floor(Date.now() / 30000),
    );
    const enabled = await request(root + "/mfa/enable", admin, "POST", {
      code,
    });
    assert.equal(enabled.status, 200);
    assert.equal(enabled.data.recoveryCodes.length, 10);
    const blocked = await request(root + "/tasks", admin);
    assert.equal(blocked.data.code, "ADMIN_MFA_REQUIRED");
    assert.equal(
      (await request("/api/editor/content", admin)).data.code,
      "ADMIN_MFA_REQUIRED",
    );
    assert.equal(
      (await request(root + "/mfa/challenge", admin, "POST", { code })).status,
      403,
    );
    const recovery = enabled.data.recoveryCodes[0],
      proof = (
        await request(root + "/mfa/challenge", admin, "POST", {
          code: recovery,
        })
      ).data.proof;
    assert.ok(proof);
    assert.equal(
      (
        await request(root + "/mfa/challenge", admin, "POST", {
          code: recovery,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await request(root + "/tasks", admin, "GET", undefined, {
          "X-Admin-MFA": proof,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await sensitive("/mfa/disable", {}, admin, "POST", {
          "X-Admin-MFA": proof,
        })
      ).status,
      200,
    );
  },
);
